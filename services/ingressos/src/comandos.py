from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
import asyncpg
from .outbox import EventoSaida
from .estados import estado_pedido
from .meios import em_reais
from . import repositorio as repo

"""
Padrão GoF: COMMAND.

Cada ação sobre o pedido — reservar, cobrar, aprovar, emitir, recusar,
expirar, cancelar — é um objeto com `executar()`. Todas passam pelo mesmo
executor, que:

  1. aplica a transição do STATE (e recusa a ação se o estado não aceitar);
  2. grava a linha de HISTÓRICO (quem fez o quê, quando, e o estado depois);
  3. devolve os eventos que a Saga precisa publicar.

O histórico sai de graça justamente porque toda ação é um comando.
"""

class ContextoComando:
    def __init__(
        self,
        c: asyncpg.Connection,
        pedido: repo.Pedido,
        autor_id: Optional[str],
        correlation_id: str
    ):
        self.c = c
        self.pedido = pedido
        self.autor_id = autor_id
        self.correlation_id = correlation_id

class ResultadoComando:
    def __init__(self, eventos: list[EventoSaida], status_apos: str):
        self.eventos = eventos
        self.status_apos = status_apos

class ComandoPedido(ABC):
    @property
    @abstractmethod
    def nome(self) -> str:
        pass

    def dados_historico(self, ctx: ContextoComando) -> dict:
        return {}

    @abstractmethod
    async def executar(self, ctx: ContextoComando) -> ResultadoComando:
        pass

async def executar(comando: ComandoPedido, ctx: ContextoComando) -> list[EventoSaida]:
    resultado = await comando.executar(ctx)
    await repo.registrar_historico(
        ctx.c,
        ctx.pedido.id,
        comando.nome,
        ctx.autor_id,
        comando.dados_historico(ctx),
        resultado.status_apos
    )
    return resultado.eventos

# ---------------- Comandos Concretos ----------------

class SolicitarCompra(ComandoPedido):
    @property
    def nome(self) -> str:
        return "SOLICITAR_COMPRA"

    def __init__(self, itens: list[dict]):
        self.itens = itens

    def dados_historico(self, ctx: ContextoComando) -> dict:
        total = sum(i.get("quantidade", 0) for i in self.itens)
        return {"itens": self.itens, "totalItens": total}

    async def executar(self, ctx: ContextoComando) -> ResultadoComando:
        return ResultadoComando(
            status_apos=ctx.pedido.status,
            eventos=[
                EventoSaida(
                    nome="compra.solicitada",
                    correlation_id=ctx.correlation_id,
                    payload={
                        "pedidoId": ctx.pedido.id,
                        "eventoId": ctx.pedido.evento_id,
                        "compradorId": ctx.pedido.comprador_id,
                        "itens": self.itens,
                        "destinatarios": [],
                    }
                )
            ]
        )

class SolicitarPagamento(ComandoPedido):
    @property
    def nome(self) -> str:
        return "SOLICITAR_PAGAMENTO"

    def __init__(self, total_centavos: int):
        self.total_centavos = total_centavos

    def dados_historico(self, ctx: ContextoComando) -> dict:
        return {"valor": em_reais(self.total_centavos), "meio": ctx.pedido.meio}

    async def executar(self, ctx: ContextoComando) -> ResultadoComando:
        proximo = estado_pedido(ctx.pedido.status).cobrar()
        await repo.atualizar_status_pedido(ctx.c, ctx.pedido.id, proximo.nome)

        return ResultadoComando(
            status_apos=proximo.nome,
            eventos=[
                EventoSaida(
                    nome="pagamento.solicitado",
                    correlation_id=ctx.correlation_id,
                    payload={
                        "pedidoId": ctx.pedido.id,
                        "eventoId": ctx.pedido.evento_id,
                        "compradorId": ctx.pedido.comprador_id,
                        "valorCentavos": self.total_centavos,
                        "meio": ctx.pedido.meio,
                        "referenciaPagamento": ctx.pedido.referencia_pagamento,
                        "eventoNome": ctx.pedido.evento_nome or "evento",
                        "destinatarios": [],
                    }
                )
            ]
        )

class EmitirIngressos(ComandoPedido):
    @property
    def nome(self) -> str:
        return "EMITIR_INGRESSOS"

    def __init__(self, autorizacao: Optional[str]):
        self.autorizacao = autorizacao

    def dados_historico(self, ctx: ContextoComando) -> dict:
        return {"autorizacao": self.autorizacao}

    async def executar(self, ctx: ContextoComando) -> ResultadoComando:
        c, pedido = ctx.c, ctx.pedido

        # Aprovado -> PAGO -> (emite) -> CONCLUIDO
        pago = estado_pedido(pedido.status).aprovar()
        await repo.atualizar_status_pedido(c, pedido.id, pago.nome)

        itens = await repo.itens_do_pedido(c, pedido.id)
        emitidos: list[repo.Ingresso] = []

        for item in itens:
            for _ in range(item.quantidade):
                emitidos.append(await repo.emitir_ingresso(c, {
                    "pedidoId": pedido.id,
                    "eventoId": pedido.evento_id,
                    "titularId": pedido.comprador_id,
                    "organizadorId": pedido.organizador_id,
                    "setorNome": item.setor_nome,
                    "loteNome": item.lote_nome,
                    "politica": item.politica,
                    "precoCentavos": item.preco_unitario_centavos,
                    "eventoNome": pedido.evento_nome,
                    "eventoDataHora": pedido.evento_data_hora,
                    "eventoLocal": pedido.evento_local,
                }))

        concluido = estado_pedido(pago.nome).concluir()
        await repo.atualizar_status_pedido(c, pedido.id, concluido.nome)

        return ResultadoComando(
            status_apos=concluido.nome,
            eventos=[
                EventoSaida(
                    nome="ingresso.emitido",
                    correlation_id=ctx.correlation_id,
                    payload={
                        "pedidoId": pedido.id,
                        "eventoId": pedido.evento_id,
                        "compradorId": pedido.comprador_id,
                        "eventoNome": pedido.evento_nome or "evento",
                        "eventoDataHora": pedido.evento_data_hora.isoformat() if pedido.evento_data_hora else None,
                        "eventoLocal": pedido.evento_local,
                        "totalCentavos": pedido.total_centavos,
                        "ingressos": [
                            {
                                "ingressoId": i.id,
                                "codigo": i.codigo,
                                "setorNome": i.setor_nome,
                                "loteNome": i.lote_nome,
                                "politica": i.politica,
                            }
                            for i in emitidos
                        ],
                        "destinatarios": [pedido.comprador_id],
                    }
                )
            ]
        )

class EncerrarPedido(ComandoPedido):
    def __init__(
        self,
        nome_cmd: str,
        destino: str,
        motivo: str,
        invalidar_ingressos: bool = False
    ):
        self._nome = nome_cmd
        self.destino = destino
        self.motivo = motivo
        self.invalidar_ingressos = invalidar_ingressos

    @property
    def nome(self) -> str:
        return self._nome

    def dados_historico(self, ctx: ContextoComando) -> dict:
        return {"motivo": self.motivo, "destino": self.destino}

    async def executar(self, ctx: ContextoComando) -> ResultadoComando:
        c, pedido = ctx.c, ctx.pedido
        estado = estado_pedido(pedido.status)

        precisa_liberar_lugares = estado.tem_lugares_reservados()
        precisa_estornar = estado.exige_estorno()

        match self.destino:
            case "RECUSADO": proximo = estado.recusar()
            case "EXPIRADO": proximo = estado.expirar()
            case _: proximo = estado.cancelar()

        await repo.atualizar_status_pedido(c, pedido.id, proximo.nome, self.motivo)

        novo_status = "INVALIDADO" if self.invalidar_ingressos else "CANCELADO"
        for ingresso in await repo.ingressos_do_pedido(c, pedido.id):
            if ingresso.status in ("EMITIDO", "UTILIZADO"):
                await repo.atualizar_status_ingresso(c, ingresso.id, novo_status)

        eventos: list[EventoSaida] = []

        if precisa_liberar_lugares:
            itens = await repo.itens_do_pedido(c, pedido.id)
            eventos.append(
                EventoSaida(
                    nome="pedido.cancelado",
                    correlation_id=ctx.correlation_id,
                    payload={
                        "pedidoId": pedido.id,
                        "eventoId": pedido.evento_id,
                        "compradorId": pedido.comprador_id,
                        "motivo": self.motivo,
                        "situacao": proximo.nome,
                        "eventoNome": pedido.evento_nome or "evento",
                        "itens": [{"loteId": i.lote_id, "quantidade": i.quantidade} for i in itens],
                        "destinatarios": [pedido.comprador_id],
                    }
                )
            )

        if precisa_estornar:
            eventos.append(
                EventoSaida(
                    nome="estorno.solicitado",
                    correlation_id=ctx.correlation_id,
                    payload={
                        "pedidoId": pedido.id,
                        "eventoId": pedido.evento_id,
                        "compradorId": pedido.comprador_id,
                        "motivo": self.motivo,
                        "eventoNome": pedido.evento_nome or "evento",
                        "destinatarios": [],
                    }
                )
            )

        return ResultadoComando(status_apos=proximo.nome, eventos=eventos)

def recusar_por_pagamento(motivo: str) -> EncerrarPedido:
    return EncerrarPedido("RECUSAR_PAGAMENTO", "RECUSADO", motivo)

def recusar_por_reserva(motivo: str) -> EncerrarPedido:
    return EncerrarPedido("RECUSAR_RESERVA", "RECUSADO", motivo)

def expirar_pedido(motivo: str) -> EncerrarPedido:
    return EncerrarPedido("EXPIRAR", "EXPIRADO", motivo)

def cancelar_pedido(motivo: str) -> EncerrarPedido:
    return EncerrarPedido("CANCELAR", "CANCELADO", motivo)

def cancelar_por_evento_cancelado(motivo: str) -> EncerrarPedido:
    return EncerrarPedido("CANCELAR_EVENTO_CANCELADO", "CANCELADO", motivo, invalidar_ingressos=True)

class ValidarEntrada(ComandoPedido):
    @property
    def nome(self) -> str:
        return "VALIDAR_ENTRADA"

    def __init__(self, ingresso: repo.Ingresso):
        self.ingresso = ingresso

    def dados_historico(self, ctx: ContextoComando) -> dict:
        return {"ingressoId": self.ingresso.id, "codigo": self.ingresso.codigo}

    async def executar(self, ctx: ContextoComando) -> ResultadoComando:
        return ResultadoComando(status_apos=ctx.pedido.status, eventos=[])
