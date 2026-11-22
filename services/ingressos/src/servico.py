import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Dict, List, Optional
import uuid
import asyncpg
from .auth import Autor
from .config import PEDIDO_EXPIRA_SEGUNDOS, EXPIRACAO_INTERVALO_MS
from .db import get_pool
from .estados import estado_ingresso, estado_pedido
from .outbox import EventoSaida, transacao, transacao_com
from . import comandos as cmd
from . import repositorio as repo
from .validacoes import cadeia_de_compra, ContextoCompra, ItemCompra

class ErroNegocio(Exception):
    def __init__(self, status: int, mensagem: str):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem

class ResultadoValidacao:
    def __init__(self, aprovado: bool, motivo: Optional[str], ingresso: Optional[repo.Ingresso]):
        self.aprovado = aprovado
        self.motivo = motivo
        self.ingresso = ingresso

ENCERRADO_SEM_CONCLUIR = ["CANCELADO", "EXPIRADO", "RECUSADO"]

# ================= Início da compra =================

async def solicitar_compra(d: dict, autor: Autor, correlation_id: str) -> repo.Pedido:
    async def _op(c: asyncpg.Connection):
        raw_itens = d.get("itens", [])
        itens_compra = [
            ItemCompra(
                lote_id=i.get("loteId", i.get("lote_id")),
                quantidade=i.get("quantidade", 0),
                politica=i.get("politica", "INTEIRA")
            )
            for i in raw_itens
        ]

        evento_id = d["eventoId"]
        meio = d["meio"]
        referencia = d["referenciaPagamento"]

        ctx = ContextoCompra(
            autor=autor,
            evento_id=evento_id,
            itens=itens_compra,
            meio=meio,
            referencia_pagamento=referencia,
            ja_pedidos=await repo.quantidade_ja_pedida(c, evento_id, autor.id),
            pedido_em_andamento=await repo.tem_pedido_em_andamento(c, evento_id, autor.id),
        )

        recusa = cadeia_de_compra().verificar(ctx)
        if recusa:
            raise ErroNegocio(recusa.status, recusa.mensagem)

        expira_em = datetime.now(timezone.utc) + timedelta(seconds=PEDIDO_EXPIRA_SEGUNDOS)

        pedido = await repo.criar_pedido(c, {
            "eventoId": evento_id,
            "compradorId": autor.id,
            "meio": meio,
            "referenciaPagamento": referencia.strip(),
            "expiraEm": expira_em,
            "itens": [{"loteId": i.lote_id, "quantidade": i.quantidade, "politica": i.politica} for i in itens_compra]
        })

        eventos = await cmd.executar(
            cmd.SolicitarCompra([{"loteId": i.lote_id, "quantidade": i.quantidade, "politica": i.politica} for i in itens_compra]),
            cmd.ContextoComando(c, pedido, autor.id, correlation_id)
        )

        return pedido, eventos

    return await transacao_com(_op)

# ================= Reações da Saga =================

async def idempotente(evento: Dict[str, Any], fn: Callable[[], Any]) -> None:
    event_id = evento.get("eventId")
    if not event_id:
        return
    if not await repo.marcar_processado(event_id):
        return
    try:
        await fn()
    except Exception as e:
        await repo.desmarcar_processado(event_id)
        raise e

async def aplicar(
    pedido_id: str,
    comando: cmd.ComandoPedido,
    autor_id: Optional[str],
    correlation_id: str,
    aceita: Callable[[str], bool]
) -> bool:
    aplicou = False

    async def _op(c: asyncpg.Connection):
        nonlocal aplicou
        pedido = await repo.buscar_pedido(c, pedido_id, travar=True)
        if not pedido:
            print(f"[ingressos] pedido {pedido_id} não encontrado; nada a fazer")
            return []
        if not aceita(pedido.status):
            print(f"[ingressos] pedido {pedido_id} está {pedido.status}; comando {comando.nome} ignorado")
            return []
        eventos = await cmd.executar(comando, cmd.ContextoComando(c, pedido, autor_id, correlation_id))
        aplicou = True
        return eventos

    await transacao(_op)
    return aplicou

async def tratar_lugares_reservados(evento: Dict[str, Any]) -> None:
    async def _processar():
        p = evento.get("payload", {})
        pedido_id = p.get("pedidoId")
        correlation_id = evento.get("correlationId", "")

        async def _op(c: asyncpg.Connection):
            pedido = await repo.buscar_pedido(c, pedido_id, travar=True)
            if pedido and pedido.status in ENCERRADO_SEM_CONCLUIR:
                print(f"[ingressos] reserva do pedido {pedido_id} chegou com pedido {pedido.status}; devolvendo lugares")
                itens = await repo.itens_do_pedido(c, pedido.id)
                await repo.registrar_historico(
                    c, pedido.id, "DEVOLVER_RESERVA_TARDIA", None,
                    {"motivo": "a reserva chegou depois do encerramento do pedido"}, pedido.status
                )
                return [
                    EventoSaida(
                        nome="pedido.cancelado",
                        correlation_id=correlation_id,
                        payload={
                            "pedidoId": pedido.id,
                            "eventoId": pedido.evento_id,
                            "compradorId": pedido.comprador_id,
                            "motivo": "a reserva chegou depois do encerramento do pedido",
                            "situacao": pedido.status,
                            "eventoNome": p.get("eventoNome"),
                            "itens": [{"loteId": i.lote_id, "quantidade": i.quantidade} for i in itens],
                            "destinatarios": [],
                        }
                    )
                ]

            if not pedido or pedido.status != "PENDENTE":
                print(f"[ingressos] pedido {pedido_id} não está PENDENTE; reserva ignorada")
                return []

            await repo.aplicar_reserva(c, pedido_id, p)
            novo_status = estado_pedido(pedido.status).reservar().nome
            await repo.atualizar_status_pedido(c, pedido_id, novo_status)
            await repo.registrar_historico(
                c, pedido_id, "RESERVAR_LUGARES", None,
                {"totalCentavos": p.get("totalCentavos")}, "RESERVADO"
            )

            atualizado = await repo.buscar_pedido(c, pedido_id)
            return await cmd.executar(
                cmd.SolicitarPagamento(p.get("totalCentavos", 0)),
                cmd.ContextoComando(c, atualizado, None, correlation_id)
            )

        await transacao(_op)

    await idempotente(evento, _processar)

async def tratar_reserva_recusada(evento: Dict[str, Any]) -> None:
    async def _processar():
        payload = evento.get("payload", {})
        pedido_id = payload.get("pedidoId")
        motivo = payload.get("motivo", "reserva recusada")
        corr = evento.get("correlationId", "")
        await aplicar(pedido_id, cmd.recusar_por_reserva(motivo), None, corr, lambda s: s == "PENDENTE")

    await idempotente(evento, _processar)

async def tratar_pagamento_aprovado(evento: Dict[str, Any]) -> None:
    async def _processar():
        payload = evento.get("payload", {})
        pedido_id = payload.get("pedidoId")
        autorizacao = payload.get("autorizacao")
        corr = evento.get("correlationId", "")

        async def _op(c: asyncpg.Connection):
            pedido = await repo.buscar_pedido(c, pedido_id, travar=True)
            if not pedido:
                print(f"[ingressos] pagamento aprovado para pedido inexistente {pedido_id}; ignorado")
                return []

            if pedido.status == "AGUARDANDO_PAGAMENTO":
                return await cmd.executar(
                    cmd.EmitirIngressos(autorizacao),
                    cmd.ContextoComando(c, pedido, None, corr)
                )

            if pedido.status in ENCERRADO_SEM_CONCLUIR:
                print(f"[ingressos] pagamento aprovado chegou com pedido {pedido.status}; pedindo estorno")
                await repo.registrar_historico(
                    c, pedido.id, "ESTORNAR_PAGAMENTO_TARDIO", None,
                    {"motivo": "pagamento aprovado depois do encerramento do pedido", "autorizacao": autorizacao},
                    pedido.status
                )
                return [
                    EventoSaida(
                        nome="estorno.solicitado",
                        correlation_id=corr,
                        payload={
                            "pedidoId": pedido.id,
                            "eventoId": pedido.evento_id,
                            "compradorId": pedido.comprador_id,
                            "motivo": "o pagamento foi aprovado depois de o pedido ter sido encerrado",
                            "eventoNome": pedido.evento_nome or "evento",
                            "destinatarios": [],
                        }
                    )
                ]

            print(f"[ingressos] pedido {pedido_id} está {pedido.status}; pagamento aprovado ignorado")
            return []

        await transacao(_op)

    await idempotente(evento, _processar)

async def tratar_pagamento_recusado(evento: Dict[str, Any]) -> None:
    async def _processar():
        payload = evento.get("payload", {})
        pedido_id = payload.get("pedidoId")
        motivo = payload.get("motivo", "pagamento recusado")
        corr = evento.get("correlationId", "")
        await aplicar(
            pedido_id,
            cmd.recusar_por_pagamento(motivo),
            None,
            corr,
            lambda s: s in ("AGUARDANDO_PAGAMENTO", "RESERVADO")
        )

    await idempotente(evento, _processar)

async def tratar_estorno_concluido(evento: Dict[str, Any]) -> None:
    async def _processar():
        p = evento.get("payload", {})
        pedido_id = p.get("pedidoId")
        async def _op(c: asyncpg.Connection):
            pedido = await repo.buscar_pedido(c, pedido_id, travar=True)
            if not pedido:
                return []
            await repo.registrar_historico(
                c, pedido_id, "ESTORNO_CONCLUIDO", None,
                {"valorCentavos": p.get("valorCentavos"), "automatico": p.get("automatico"), "motivo": p.get("motivo")},
                pedido.status
            )
            return []
        await transacao(_op)

    await idempotente(evento, _processar)

async def tratar_evento_cancelado(evento: Dict[str, Any]) -> None:
    async def _processar():
        p = evento.get("payload", {})
        evento_id = p.get("eventoId")
        nome = p.get("nome", "evento")
        motivo = p.get("motivo", "")
        razao = f'o evento "{nome}" foi cancelado: {motivo}'
        corr = evento.get("correlationId", "")

        pedidos = await repo.listar_pedidos(evento_id=evento_id, limite=500)
        n = 0
        for ped in pedidos:
            aplicou = await aplicar(
                ped.id,
                cmd.cancelar_por_evento_cancelado(razao),
                None,
                corr,
                lambda s: s not in ("CANCELADO", "EXPIRADO", "RECUSADO")
            )
            if aplicou:
                n += 1
        if n:
            print(f"[ingressos] evento {evento_id} cancelado: {n} pedido(s) encerrado(s)")

    await idempotente(evento, _processar)

async def tratar_evento_alterado(evento: Dict[str, Any]) -> None:
    async def _processar():
        p = evento.get("payload", {})
        evento_id = p.get("eventoId")
        corr = evento.get("correlationId", "")

        dt = None
        if p.get("dataHora"):
            try:
                dt = datetime.fromisoformat(str(p["dataHora"]).replace("Z", "+00:00"))
            except Exception:
                pass

        async def _op(c: asyncpg.Connection):
            await c.execute(
                """
                UPDATE pedidos SET evento_nome = $2, evento_data_hora = $3, evento_local = $4
                WHERE evento_id = $1
                """,
                uuid.UUID(evento_id), p.get("nome"), dt, p.get("local")
            )
            await c.execute(
                """
                UPDATE ingressos SET evento_nome = $2, evento_data_hora = $3, evento_local = $4
                WHERE evento_id = $1
                """,
                uuid.UUID(evento_id), p.get("nome"), dt, p.get("local")
            )

            rows = await c.fetch(
                """
                SELECT DISTINCT titular_id FROM ingressos
                WHERE evento_id = $1 AND status IN ('EMITIDO','UTILIZADO')
                """,
                uuid.UUID(evento_id)
            )
            destinatarios = [str(r["titular_id"]) for r in rows]
            if not destinatarios:
                return []

            print(f"[ingressos] evento {evento_id} alterado; avisando {len(destinatarios)} comprador(es)")

            return [
                EventoSaida(
                    nome="ingressos.afetados",
                    correlation_id=corr,
                    payload={
                        "eventoId": evento_id,
                        "eventoNome": p.get("nome"),
                        "dataHora": p.get("dataHora"),
                        "local": p.get("local"),
                        "alteracoes": p.get("alteracoes", []),
                        "quantidadeTitulares": len(destinatarios),
                        "destinatarios": destinatarios,
                    }
                )
            ]

        await transacao(_op)

    await idempotente(evento, _processar)

async def tratar_usuario_removido(evento: Dict[str, Any]) -> None:
    async def _processar():
        usuario_id = evento.get("payload", {}).get("usuarioId")
        corr = evento.get("correlationId", "")
        pedidos = await repo.listar_pedidos(comprador_id=usuario_id, limite=500)
        for ped in pedidos:
            await aplicar(
                ped.id,
                cmd.cancelar_pedido("o titular encerrou a conta"),
                None,
                corr,
                lambda s: s not in ("CANCELADO", "EXPIRADO", "RECUSADO")
            )

    await idempotente(evento, _processar)

# ================= Expiração =================

async def varrer_expirados() -> int:
    expirados = 0
    pool = get_pool()
    async with pool.acquire() as c:
        async with c.transaction():
            lista = await repo.pedidos_expirados(c, 50)

    for p in lista:
        minutos = round(PEDIDO_EXPIRA_SEGUNDOS / 60)
        msg_expira = f"o pedido não foi concluído em {f'{minutos} min' if minutos >= 1 else f'{PEDIDO_EXPIRA_SEGUNDOS}s'} e expirou"
        aplicou = await aplicar(
            p.id,
            cmd.expirar_pedido(msg_expira),
            None,
            f"expiracao-{p.id}",
            lambda s: s in ("PENDENTE", "RESERVADO", "AGUARDANDO_PAGAMENTO")
        )
        if aplicou:
            expirados += 1
            print(f"[ingressos] pedido {p.id} expirou; lugares serão liberados pela compensação")

    return expirados

async def iniciar_varredor(intervalo_s: float = 15.0) -> None:
    while True:
        try:
            await varrer_expirados()
        except Exception as e:
            print(f"[ingressos] varredor de expiração falhou: {e}")
        await asyncio.sleep(intervalo_s)

# ================= Ações do Usuário =================

async def cancelar(pedido_id: str, autor: Autor, motivo: str, correlation_id: str) -> None:
    pedido = await repo.buscar_pedido(None, pedido_id)
    if not pedido:
        raise ErroNegocio(404, "pedido não encontrado")
    if autor.papel != "ADM" and pedido.comprador_id != autor.id:
        raise ErroNegocio(403, "você só pode cancelar os seus próprios pedidos")

    if not estado_pedido(pedido.status).aceita_cancelamento():
        raise ErroNegocio(409, f"um pedido em {pedido.status} não pode ser cancelado")

    aplicou = await aplicar(
        pedido_id,
        cmd.cancelar_pedido(motivo or "cancelado pelo comprador"),
        autor.id,
        correlation_id,
        lambda s: estado_pedido(s).aceita_cancelamento()
    )
    if not aplicou:
        raise ErroNegocio(409, "o pedido mudou de situação; recarregue e tente de novo")

async def cancelar_ingresso(ingresso_id: str, autor: Autor, correlation_id: str) -> repo.Ingresso:
    async def _op(c: asyncpg.Connection):
        ingresso = await repo.buscar_ingresso(c, ingresso_id, travar=True)
        if not ingresso:
            raise ErroNegocio(404, "ingresso não encontrado")
        if autor.papel != "ADM" and ingresso.titular_id != autor.id:
            raise ErroNegocio(403, "você só pode cancelar os seus próprios ingressos")
        if ingresso.status != "EMITIDO":
            raise ErroNegocio(409, estado_ingresso(ingresso.status).motivo_recusa())

        novo_status = estado_ingresso(ingresso.status).cancelar().nome
        await repo.atualizar_status_ingresso(c, ingresso_id, novo_status)

        pedido = await repo.buscar_pedido(c, ingresso.pedido_id, travar=True)
        eventos: list[EventoSaida] = []

        if pedido:
            await repo.registrar_historico(
                c, pedido.id, "CANCELAR_INGRESSO", autor.id,
                {"ingressoId": ingresso.id, "codigo": ingresso.codigo}, pedido.status
            )
            restantes = [
                i for i in await repo.ingressos_do_pedido(c, pedido.id)
                if i.status in ("EMITIDO", "UTILIZADO")
            ]
            if len(restantes) == 0 and estado_pedido(pedido.status).aceita_cancelamento():
                eventos.extend(await cmd.executar(
                    cmd.cancelar_pedido("todos os ingressos do pedido foram cancelados"),
                    cmd.ContextoComando(c, pedido, autor.id, correlation_id)
                ))

        atualizado = await repo.buscar_ingresso(c, ingresso_id)
        return atualizado, eventos

    return await transacao_com(_op)

# ================= Check-in =================

async def validar_entrada(
    codigo: str, autor: Autor, correlation_id: str
) -> ResultadoValidacao:
    ingresso = await repo.buscar_ingresso_por_codigo(None, codigo)
    if not ingresso:
        return ResultadoValidacao(aprovado=False, motivo="código não encontrado", ingresso=None)

    if autor.papel == "PARTICIPANTE":
        raise ErroNegocio(403, "somente o organizador do evento valida ingressos na entrada")

    if autor.papel == "ORGANIZADOR" and ingresso.organizador_id != autor.id:
        return ResultadoValidacao(
            aprovado=False, motivo="este ingresso é de um evento de outro organizador", ingresso=None
        )

    if ingresso.status != "EMITIDO":
        return ResultadoValidacao(
            aprovado=False, motivo=estado_ingresso(ingresso.status).motivo_recusa(), ingresso=ingresso
        )

    ok = await repo.registrar_entrada(None, ingresso.id, autor.id)
    if not ok:
        atual = await repo.buscar_ingresso(None, ingresso.id)
        motivo = estado_ingresso(atual.status).motivo_recusa() if atual else "ingresso inválido"
        return ResultadoValidacao(aprovado=False, motivo=motivo, ingresso=atual)

    async def _log_hist(c: asyncpg.Connection):
        pedido = await repo.buscar_pedido(c, ingresso.pedido_id, travar=True)
        if pedido:
            await repo.registrar_historico(
                c, pedido.id, "VALIDAR_ENTRADA", autor.id,
                {"ingressoId": ingresso.id, "codigo": ingresso.codigo}, pedido.status
            )
        return []

    await transacao(_log_hist)
    atualizado = await repo.buscar_ingresso(None, ingresso.id)
    return ResultadoValidacao(aprovado=True, motivo=None, ingresso=atualizado)
