from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import asyncpg
from .auth import Autor
from .db import get_pool
from .estados import estado_de, TransicaoInvalida
from .estrutura import EventoComposto, Lote, Setor
from .precos import PoliticaPreco, em_reais
from .outbox import EventoSaida, transacao, transacao_com
from .validacoes import ItemPedido
from . import repositorio as repo

class ErroNegocio(Exception):
    def __init__(self, status: int, mensagem: str):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem

class RecusaReserva(Exception):
    def __init__(self, mensagem: str):
        super().__init__(mensagem)
        self.mensagem = mensagem

async def evento_sob_controle(c: asyncpg.Connection, id: str, a: Autor) -> repo.Evento:
    e = await repo.buscar_evento(id, c, travar=True)
    if not e:
        raise ErroNegocio(404, "evento não encontrado")
    if a.papel != "ADM" and e.organizador_id != a.id:
        raise ErroNegocio(403, "somente o organizador do evento pode fazer isso")
    return e

# ================= Ciclo de vida do evento (State) =================

async def publicar(id: str, a: Autor) -> str:
    async def _op(c: asyncpg.Connection):
        e = await evento_sob_controle(c, id, a)
        proximo = estado_de(e.status).publicar()

        arvore = await repo.carregar_estrutura(c, e)
        if arvore.capacidade() <= 0:
            raise ErroNegocio(409, "crie ao menos um setor com um lote antes de publicar")

        await repo.atualizar_status(c, id, proximo.nome)
        return proximo.nome, []

    return await transacao_com(_op)

async def abrir_vendas(id: str, a: Autor) -> str:
    async def _op(c: asyncpg.Connection):
        e = await evento_sob_controle(c, id, a)
        proximo = estado_de(e.status).abrir_vendas()
        await repo.atualizar_status(c, id, proximo.nome)
        return proximo.nome, []

    return await transacao_com(_op)

async def encerrar_vendas(id: str, a: Autor) -> str:
    async def _op(c: asyncpg.Connection):
        e = await evento_sob_controle(c, id, a)
        proximo = estado_de(e.status).encerrar_vendas()
        await repo.atualizar_status(c, id, proximo.nome)
        return proximo.nome, []

    return await transacao_com(_op)

async def realizar(id: str, a: Autor) -> str:
    async def _op(c: asyncpg.Connection):
        e = await evento_sob_controle(c, id, a)
        proximo = estado_de(e.status).realizar()
        await repo.atualizar_status(c, id, proximo.nome)
        return proximo.nome, []

    return await transacao_com(_op)

async def cancelar(id: str, a: Autor, motivo: str, correlation_id: str) -> str:
    async def _op(c: asyncpg.Connection):
        e = await evento_sob_controle(c, id, a)
        proximo = estado_de(e.status).cancelar()
        await repo.atualizar_status(c, id, proximo.nome, motivo)

        eventos = [
            EventoSaida(
                nome="evento.cancelado",
                correlation_id=correlation_id,
                payload={
                    "eventoId": e.id,
                    "nome": e.nome,
                    "dataHora": e.data_hora.isoformat(),
                    "local": e.local,
                    "motivo": motivo,
                    "organizadorId": e.organizador_id,
                    "destinatarios": [],
                }
            )
        ]
        return proximo.nome, eventos

    return await transacao_com(_op)

# ================= Dados do evento =================

async def criar(d: repo.DadosEvento, a: Autor) -> repo.Evento:
    return await repo.criar_evento(d, a.id)

async def editar(id: str, a: Autor, d: dict, correlation_id: str) -> repo.Evento:
    async def _op(c: asyncpg.Connection):
        e = await evento_sob_controle(c, id, a)
        if not estado_de(e.status).aceita_edicao_dados():
            raise ErroNegocio(409, f"não é possível editar um evento em {e.status}")

        alteracoes: list[str] = []
        if d.get("nome") is not None and d.get("nome") != e.nome:
            alteracoes.append("nome")
        if d.get("local") is not None and d.get("local") != e.local:
            alteracoes.append("local")
        if d.get("data_hora") is not None:
            nova_dt = d["data_hora"]
            if nova_dt != e.data_hora:
                alteracoes.append("data")

        await repo.atualizar_evento(c, id, d)
        atualizado = await repo.buscar_evento(id, c)

        eventos: list[EventoSaida] = []
        if alteracoes:
            eventos.append(
                EventoSaida(
                    nome="evento.alterado",
                    correlation_id=correlation_id,
                    payload={
                        "eventoId": atualizado.id,
                        "nome": atualizado.nome,
                        "dataHora": atualizado.data_hora.isoformat(),
                        "local": atualizado.local,
                        "alteracoes": alteracoes,
                        "organizadorId": atualizado.organizador_id,
                        "destinatarios": [],
                    }
                )
            )
        return atualizado, eventos

    return await transacao_com(_op)

async def excluir(id: str, a: Autor) -> None:
    async def _op(c: asyncpg.Connection):
        e = await evento_sob_controle(c, id, a)
        if not estado_de(e.status).permite_exclusao():
            raise ErroNegocio(409, f"um evento em {e.status} não pode ser excluído; cancele-o")

        arvore = await repo.carregar_estrutura(c, e)
        if arvore.reservados() > 0:
            raise ErroNegocio(409, "este evento já tem lugares vendidos; cancele o evento em vez de excluí-lo")

        await repo.remover_evento(c, id)
        return []

    await transacao(_op)

# ================= Setores e Lotes (Composite) =================

async def estrutura_editavel(c: asyncpg.Connection, evento_id: str, a: Autor) -> repo.Evento:
    e = await evento_sob_controle(c, evento_id, a)
    if not estado_de(e.status).aceita_edicao_estrutura():
        raise ErroNegocio(409, f"não é possível alterar setores e lotes de um evento em {e.status}")
    return e

async def criar_setor(evento_id: str, a: Autor, nome: str, descricao: Optional[str]) -> repo.LinhaSetor:
    async def _op(c: asyncpg.Connection):
        await estrutura_editavel(c, evento_id, a)
        setor = await repo.criar_setor(c, evento_id, nome, descricao)
        return setor, []

    return await transacao_com(_op)

async def editar_setor(
    evento_id: str, setor_id: str, a: Autor, nome: Optional[str] = None, descricao: Optional[str] = None
) -> repo.LinhaSetor:
    async def _op(c: asyncpg.Connection):
        await estrutura_editavel(c, evento_id, a)
        s = await repo.setor_do_evento(c, setor_id, evento_id)
        if not s:
            raise ErroNegocio(404, "setor não encontrado neste evento")
        await repo.atualizar_setor(c, setor_id, nome, descricao)
        atualizado = await repo.buscar_setor(c, setor_id)
        return atualizado, []

    return await transacao_com(_op)

async def excluir_setor(evento_id: str, setor_id: str, a: Autor) -> None:
    async def _op(c: asyncpg.Connection):
        e = await estrutura_editavel(c, evento_id, a)
        s = await repo.setor_do_evento(c, setor_id, evento_id)
        if not s:
            raise ErroNegocio(404, "setor não encontrado neste evento")

        arvore = await repo.carregar_estrutura(c, e)
        setor = next((x for x in arvore.filhos() if x.id == setor_id), None)
        if setor and setor.reservados() > 0:
            raise ErroNegocio(409, "este setor já tem lugares vendidos e não pode ser excluído")

        await repo.remover_setor(c, setor_id)
        return []

    await transacao(_op)

async def criar_lote(evento_id: str, setor_id: str, a: Autor, d: repo.DadosLote) -> Lote:
    async def _op(c: asyncpg.Connection):
        await estrutura_editavel(c, evento_id, a)
        s = await repo.setor_do_evento(c, setor_id, evento_id)
        if not s:
            raise ErroNegocio(404, "setor não encontrado neste evento")
        lote = await repo.criar_lote(c, setor_id, d)
        return lote, []

    return await transacao_com(_op)

async def editar_lote(evento_id: str, lote_id: str, a: Autor, d: dict) -> Lote:
    async def _op(c: asyncpg.Connection):
        await estrutura_editavel(c, evento_id, a)
        if await repo.evento_do_lote(c, lote_id) != evento_id:
            raise ErroNegocio(404, "lote não encontrado neste evento")

        lote = await repo.buscar_lote(c, lote_id, travar=True)
        if not lote:
            raise ErroNegocio(404, "lote não encontrado")

        if d.get("capacidade") is not None and d["capacidade"] < lote.reservados():
            raise ErroNegocio(409, f"a capacidade não pode ficar abaixo dos {lote.reservados()} lugares já vendidos")

        await repo.atualizar_lote(c, lote_id, d)
        atualizado = await repo.buscar_lote(c, lote_id)
        return atualizado, []

    return await transacao_com(_op)

async def excluir_lote(evento_id: str, lote_id: str, a: Autor) -> None:
    async def _op(c: asyncpg.Connection):
        await estrutura_editavel(c, evento_id, a)
        if await repo.evento_do_lote(c, lote_id) != evento_id:
            raise ErroNegocio(404, "lote não encontrado neste evento")

        lote = await repo.buscar_lote(c, lote_id, travar=True)
        if not lote:
            raise ErroNegocio(404, "lote não encontrado")
        if lote.reservados() > 0:
            raise ErroNegocio(409, "este lote já tem lugares vendidos e não pode ser excluído")

        await repo.remover_lote(c, lote_id)
        return []

    await transacao(_op)

# ================= Cotação (Strategy) =================

def montar_cotacao(
    e: Any, arvore: EventoComposto, itens: list[ItemPedido]
) -> dict:
    agora = datetime.now(timezone.utc)
    linhas: list[dict] = []
    for item in itens:
        lote = arvore.achar_lote(item.lote_id)
        if not lote:
            raise ErroNegocio(404, f"lote {item.lote_id} não pertence a este evento")
        if not lote.vigente(agora):
            raise ErroNegocio(409, f'o lote "{lote.nome}" não está vigente')

        setor = next(s for s in arvore.filhos() if any(l.id == lote.id for l in s.filhos()))
        unitario = lote.preco_unitario(item.politica)
        linhas.append({
            "loteId": lote.id,
            "loteNome": lote.nome,
            "setorNome": setor.nome,
            "quantidade": item.quantidade,
            "politica": item.politica,
            "precoUnitarioCentavos": unitario,
            "subtotalCentavos": unitario * item.quantidade,
        })

    total_centavos = sum(l["subtotalCentavos"] for l in linhas)
    return {
        "eventoId": e.id,
        "eventoNome": e.nome,
        "itens": linhas,
        "totalCentavos": total_centavos,
        "total": em_reais(total_centavos),
    }

async def cotar(evento_id: str, itens: list[ItemPedido]) -> dict:
    e = await repo.buscar_evento(evento_id)
    if not e:
        raise ErroNegocio(404, "evento não encontrado")
    arvore = await repo.carregar_estrutura(None, e)
    return montar_cotacao(e, arvore, itens)

# ================= Reserva e liberação (Saga) =================

async def reservar(evento_id: str, itens: list[ItemPedido]) -> dict:
    try:
        async def _op(c: asyncpg.Connection):
            e = await repo.buscar_evento(evento_id, c, travar=True)
            if not e:
                return {"ok": False, "motivo": "evento não encontrado"}, []
            if not estado_de(e.status).aceita_vendas():
                return {"ok": False, "motivo": f"as vendas deste evento não estão abertas ({e.status})"}, []

            arvore = await repo.carregar_estrutura(c, e)
            cotacao = montar_cotacao(e, arvore, itens)

            for item in itens:
                if not await repo.reservar_lugares(c, item.lote_id, item.quantidade):
                    lote = arvore.achar_lote(item.lote_id)
                    nome_lote = lote.nome if lote else item.lote_id
                    raise RecusaReserva(f"não há {item.quantidade} lugar(es) disponível(is) no lote \"{nome_lote}\"")

            return {"ok": True, "cotacao": cotacao}, []

        return await transacao_com(_op)
    except (RecusaReserva, ErroNegocio) as err:
        return {"ok": False, "motivo": err.mensagem if hasattr(err, "mensagem") else str(err)}

async def liberar(itens: list[dict]) -> None:
    async def _op(c: asyncpg.Connection):
        for item in itens:
            await repo.liberar_lugares(c, item["loteId"], item["quantidade"])
        return []

    await transacao(_op)

# ================= Leitura para a API =================

def detalhar(e: repo.Evento, arvore: EventoComposto) -> dict:
    agora = datetime.now(timezone.utc)
    return {
        "id": e.id,
        "nome": e.nome,
        "descricao": e.descricao,
        "dataHora": e.data_hora.isoformat(),
        "local": e.local,
        "status": e.status,
        "organizadorId": e.organizador_id,
        "motivoCancelamento": e.motivo_cancelamento,
        "capacidade": arvore.capacidade(),
        "reservados": arvore.reservados(),
        "disponiveis": arvore.disponiveis(),
        "precoMinimoCentavos": arvore.preco_minimo(agora),
        "setores": [
            {
                "id": s.id,
                "nome": s.nome,
                "descricao": s.descricao,
                "capacidade": s.capacidade(),
                "reservados": s.reservados(),
                "disponiveis": s.disponiveis(),
                "lotes": [
                    {
                        "id": l.id,
                        "nome": l.nome,
                        "precoCentavos": l.preco_centavos,
                        "precoFormatado": em_reais(l.preco_unitario()),
                        "descontoPercentual": l.desconto_percentual,
                        "politicaPadrao": l.politica_padrao,
                        "capacidade": l.capacidade(),
                        "reservados": l.reservados(),
                        "disponiveis": l.disponiveis(),
                        "inicioVendas": l.inicio_vendas.isoformat() if l.inicio_vendas else None,
                        "fimVendas": l.fim_vendas.isoformat() if l.fim_vendas else None,
                        "ativo": l.ativo,
                        "vigente": l.vigente(agora),
                    }
                    for l in s.filhos()
                ],
            }
            for s in arvore.filhos()
        ],
    }
