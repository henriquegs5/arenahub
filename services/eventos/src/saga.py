from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional
import asyncpg
from .outbox import EventoSaida, transacao, transacao_com
from .servico import montar_cotacao
from .validacoes import cadeia_de_reserva, ContextoReserva, ItemPedido
from . import repositorio as repo

"""
SAGA DA COMPRA — o que cabe ao serviço de EVENTOS.

  Ingressos  --compra.solicitada-->  [AQUI]  --lugares.reservados--> Ingressos
                                             --reserva.recusada----> Ingressos

  Ingressos  --pedido.cancelado--->  [AQUI]  --lugares.liberados---> (compensação)
  Eventos    --evento.cancelado--->  [AQUI]  libera tudo do evento

IDEMPOTÊNCIA (duas camadas):
 1. `eventos_processados` descarta a reentrega do MESMO evento pelo broker.
 2. A tabela `reservas` guarda o estado por PEDIDO. É ela que protege contra o
    caso mais perigoso: liberar lugares que nunca foram reservados, ou liberar
    duas vezes. Um decremento cego em `lotes.reservados` corromperia o estoque.
"""

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

class Recusa(Exception):
    def __init__(self, mensagem: str):
        super().__init__(mensagem)
        self.mensagem = mensagem

async def tratar_compra_solicitada(evento: Dict[str, Any]) -> None:
    async def _processar():
        payload = evento.get("payload", {})
        pedido_id = payload.get("pedidoId")
        evento_id = payload.get("eventoId")
        comprador_id = payload.get("compradorId")
        raw_itens = payload.get("itens", [])
        correlation_id = evento.get("correlationId", "")

        itens = [
            ItemPedido(
                lote_id=it.get("loteId", it.get("lote_id")),
                quantidade=it.get("quantidade", 0),
                politica=it.get("politica", "INTEIRA")
            )
            for it in raw_itens
        ]

        recusa: Optional[str] = None

        try:
            async def _op(c: asyncpg.Connection):
                ja_reservado = await repo.buscar_reserva(c, pedido_id, travar=True)
                if ja_reservado:
                    print(f"[eventos] pedido {pedido_id} já tinha reserva ({ja_reservado.status}); nada a refazer")
                    return []

                e = await repo.buscar_evento(evento_id, c, travar=True)
                if not e:
                    raise Recusa("evento não encontrado")

                arvore = await repo.carregar_estrutura(c, e)
                agora = datetime.now(timezone.utc)

                ctx = ContextoReserva(e, arvore, itens, agora)
                motivo = cadeia_de_reserva().verificar(ctx)
                if motivo:
                    raise Recusa(motivo)

                cotacao = montar_cotacao(e, arvore, itens)

                for item in itens:
                    if not await repo.reservar_lugares(c, item.lote_id, item.quantidade):
                        lote = arvore.achar_lote(item.lote_id)
                        nome_lote = lote.nome if lote else item.lote_id
                        raise Recusa(f'os lugares do lote "{nome_lote}" acabaram de esgotar')

                await repo.criar_reserva(
                    c,
                    pedido_id,
                    evento_id,
                    [{"loteId": i.lote_id, "quantidade": i.quantidade} for i in itens],
                    cotacao["totalCentavos"]
                )

                return [
                    EventoSaida(
                        nome="lugares.reservados",
                        correlation_id=correlation_id,
                        payload={
                            "pedidoId": pedido_id,
                            "eventoId": evento_id,
                            "compradorId": comprador_id,
                            "organizadorId": e.organizador_id,
                            "eventoNome": e.nome,
                            "eventoDataHora": e.data_hora.isoformat(),
                            "eventoLocal": e.local,
                            "itens": [
                                {
                                    "loteId": l["loteId"],
                                    "setorNome": l["setorNome"],
                                    "loteNome": l["loteNome"],
                                    "quantidade": l["quantidade"],
                                    "politica": l["politica"],
                                    "precoUnitarioCentavos": l["precoUnitarioCentavos"],
                                }
                                for l in cotacao["itens"]
                            ],
                            "totalCentavos": cotacao["totalCentavos"],
                            "destinatarios": [],
                        }
                    )
                ]

            await transacao(_op)
        except Recusa as r:
            recusa = r.mensagem
        except Exception as err:
            raise err

        if recusa is not None:
            e = await repo.buscar_evento(evento_id)
            async def _recusar(c: asyncpg.Connection):
                return [
                    EventoSaida(
                        nome="reserva.recusada",
                        correlation_id=correlation_id,
                        payload={
                            "pedidoId": pedido_id,
                            "eventoId": evento_id,
                            "compradorId": comprador_id,
                            "eventoNome": e.nome if e else "evento",
                            "motivo": recusa,
                            "destinatarios": [],
                        }
                    )
                ]

            await transacao(_recusar)
            print(f"[eventos] reserva do pedido {pedido_id} recusada: {recusa}")

    await idempotente(evento, _processar)

async def tratar_pedido_cancelado(evento: Dict[str, Any]) -> None:
    async def _processar():
        payload = evento.get("payload", {})
        pedido_id = payload.get("pedidoId")
        motivo = payload.get("motivo", "cancelado")
        correlation_id = evento.get("correlationId", "")

        async def _op(c: asyncpg.Connection):
            reserva = await repo.buscar_reserva(c, pedido_id, travar=True)
            if not reserva:
                print(f"[eventos] pedido {pedido_id} cancelado sem reserva registrada; nada a liberar")
                return None, []
            if reserva.status != "ATIVA":
                print(f"[eventos] reserva do pedido {pedido_id} já estava {reserva.status}; nada a liberar")
                return None, []

            for item in reserva.itens:
                lote_id = item.get("loteId", item.get("lote_id"))
                quantidade = item.get("quantidade", 0)
                await repo.liberar_lugares(c, lote_id, quantidade)

            await repo.marcar_reserva_liberada(c, pedido_id)
            print(f"[eventos] lugares do pedido {pedido_id} liberados ({motivo})")

            eventos = [
                EventoSaida(
                    nome="lugares.liberados",
                    correlation_id=correlation_id,
                    payload={
                        "pedidoId": pedido_id,
                        "eventoId": reserva.evento_id,
                        "motivo": motivo,
                        "itens": reserva.itens,
                        "destinatarios": [],
                    }
                )
            ]
            return None, eventos

        await transacao_com(_op)

    await idempotente(evento, _processar)

async def tratar_evento_cancelado(evento: Dict[str, Any]) -> None:
    async def _processar():
        payload = evento.get("payload", {})
        evento_id = payload.get("eventoId")

        async def _op(c: asyncpg.Connection):
            ativas = await repo.reservas_ativas_do_evento(c, evento_id)
            for reserva in ativas:
                for item in reserva.itens:
                    lote_id = item.get("loteId", item.get("lote_id"))
                    quantidade = item.get("quantidade", 0)
                    await repo.liberar_lugares(c, lote_id, quantidade)
                await repo.marcar_reserva_liberada(c, reserva.pedido_id)

            if ativas:
                print(f"[eventos] evento {evento_id} cancelado: {len(ativas)} reserva(s) liberada(s)")
            return []

        await transacao(_op)

    await idempotente(evento, _processar)

async def tratar_usuario_removido(evento: Dict[str, Any]) -> None:
    async def _processar():
        payload = evento.get("payload", {})
        usuario_id = payload.get("usuarioId")
        correlation_id = evento.get("correlationId", "")

        async def _op(c: asyncpg.Connection):
            ativos = await repo.ativos_do_organizador(c, usuario_id)
            saidas: list[EventoSaida] = []

            for e in ativos:
                await repo.atualizar_status(c, e.id, "CANCELADO", "o organizador encerrou a conta")
                saidas.append(
                    EventoSaida(
                        nome="evento.cancelado",
                        correlation_id=correlation_id,
                        payload={
                            "eventoId": e.id,
                            "nome": e.nome,
                            "dataHora": e.data_hora.isoformat(),
                            "local": e.local,
                            "motivo": "o organizador encerrou a conta",
                            "organizadorId": e.organizador_id,
                            "destinatarios": [],
                        }
                    )
                )

            if saidas:
                print(f"[eventos] conta {usuario_id} removida: {len(saidas)} evento(s) cancelado(s)")
            return saidas

        await transacao(_op)

    await idempotente(evento, _processar)
