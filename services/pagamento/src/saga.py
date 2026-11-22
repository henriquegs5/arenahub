from typing import Any, Dict, Optional
from .meios import MeioPagamento, em_reais, estrategia_para, meio_valido
from .provedor import ProvedorSimuladoAdapter, PedidoCobranca, PedidoEstorno, mascarar_referencia
from .outbox import EventoSaida, transacao
from . import repositorio as repo

provedor = ProvedorSimuladoAdapter()

async def idempotente(evento: Dict[str, Any], fn) -> None:
    event_id = evento.get("eventId")
    if not event_id:
        return
    if not (await repo.marcar_processado(event_id)):
        return
    try:
        await fn()
    except Exception as e:
        await repo.desmarcar_processado(event_id)
        raise e

def desfecho(t: Dict[str, Any], p: Dict[str, Any], correlation_id: str) -> EventoSaida:
    if t["status"] == "APROVADO":
        return EventoSaida(
            nome="pagamento.aprovado",
            correlation_id=correlation_id,
            payload={
                "pedidoId": t["pedidoId"],
                "transacaoId": t["id"],
                "eventoId": p["eventoId"],
                "compradorId": t["compradorId"],
                "valorCentavos": t["valorCentavos"],
                "meio": t["meio"],
                "autorizacao": t.get("autorizacao"),
                "destinatarios": [],
            }
        )
    return EventoSaida(
        nome="pagamento.recusado",
        correlation_id=correlation_id,
        payload={
            "pedidoId": t["pedidoId"],
            "transacaoId": t["id"],
            "eventoId": p["eventoId"],
            "compradorId": t["compradorId"],
            "valorCentavos": t["valorCentavos"],
            "meio": t["meio"],
            "motivo": t.get("motivo") or "pagamento não autorizado",
            "eventoNome": p.get("eventoNome", ""),
            "destinatarios": [t["compradorId"]],
        }
    )

def evento_estorno(t: Dict[str, Any], p: Dict[str, Any], correlation_id: str, automatico: bool) -> EventoSaida:
    return EventoSaida(
        nome="estorno.concluido",
        correlation_id=correlation_id,
        payload={
            "pedidoId": t["pedidoId"],
            "transacaoId": t["id"],
            "eventoId": p["eventoId"],
            "compradorId": t["compradorId"],
            "valorCentavos": t["valorCentavos"],
            "automatico": automatico,
            "motivo": p.get("motivo", "estorno solicitado"),
            "eventoNome": p.get("eventoNome", ""),
            "destinatarios": [t["compradorId"]],
        }
    )

async def tratar_pagamento_solicitado(evento: Dict[str, Any]) -> None:
    async def executar():
        p = evento.get("payload", {})
        correlation_id = evento.get("correlationId", "")

        existente = await repo.buscar_por_pedido(None, p["pedidoId"])
        if existente:
            print(f"[pagamento] pedido {p['pedidoId']} já processado ({existente['status']}); republicando o desfecho")
            async def reemitir(c):
                return [desfecho(existente, p, correlation_id)]
            await transacao(reemitir)
            return

        raw_meio = p.get("meio", "")
        meio = raw_meio if meio_valido(raw_meio) else "CARTAO_CREDITO"
        referencia = p.get("referenciaPagamento") or "tok_sem_referencia"

        resultado = provedor.cobrar(PedidoCobranca(
            pedidoId=p["pedidoId"],
            valorCentavos=p["valorCentavos"],
            meio=meio,
            referenciaPagamento=referencia,
            idempotencyKey=p["pedidoId"]
        ))

        status_txt = "APROVADO" if resultado.aprovado else "RECUSADO"
        print(
            f"[pagamento] pedido {p['pedidoId']} {status_txt} "
            f"valor={em_reais(p['valorCentavos'])} meio={estrategia_para(meio).rotulo} "
            f"ref={mascarar_referencia(referencia)}"
            + (f' motivo="{resultado.motivoRecusa}"' if resultado.motivoRecusa else "")
        )

        async def gravar_e_publicar(c):
            try:
                t = await repo.gravar_cobranca(
                    c,
                    pedido_id=p["pedidoId"],
                    comprador_id=p["compradorId"],
                    valor_centavos=p["valorCentavos"],
                    meio=meio,
                    referencia_pagamento=referencia,
                    status_transacao=status_txt,
                    identificador_externo=resultado.identificadorExterno,
                    autorizacao=resultado.autorizacao,
                    motivo=resultado.motivoRecusa
                )
            except Exception as e:
                # Chave duplicada por corrida: busca a existente
                t = await repo.buscar_por_pedido(c, p["pedidoId"])
                if not t:
                    raise e
            return [desfecho(t, p, correlation_id)]

        await transacao(gravar_e_publicar)

    await idempotente(evento, executar)

async def tratar_estorno_solicitado(evento: Dict[str, Any]) -> None:
    async def executar():
        p = evento.get("payload", {})
        correlation_id = evento.get("correlationId", "")

        t = await repo.buscar_por_pedido(None, p["pedidoId"])
        if not t or t["status"] == "RECUSADO":
            print(f"[pagamento] estorno do pedido {p['pedidoId']} dispensado: não há cobrança aprovada")
            return

        if t["status"] == "ESTORNADO":
            print(f"[pagamento] pedido {p['pedidoId']} já estava estornado; republicando confirmação")
            async def republicar(c):
                return [evento_estorno(t, p, correlation_id, True)]
            await transacao(republicar)
            return

        resultado = provedor.estornar(PedidoEstorno(
            identificadorExterno=t["identificadorExterno"] or t["id"],
            meio=t["meio"],
            motivo=p.get("motivo", "estorno")
        ))

        if not resultado.estornado:
            print(f"[pagamento] estorno do pedido {p['pedidoId']} NÃO automático: {resultado.motivoRecusa}")
            async def registrar_manual(c):
                return [EventoSaida(
                    nome="estorno.concluido",
                    correlation_id=correlation_id,
                    payload={
                        "pedidoId": t["pedidoId"],
                        "transacaoId": t["id"],
                        "eventoId": p["eventoId"],
                        "compradorId": t["compradorId"],
                        "valorCentavos": t["valorCentavos"],
                        "automatico": False,
                        "motivo": resultado.motivoRecusa or "estorno manual",
                        "eventoNome": p.get("eventoNome", ""),
                        "destinatarios": [t["compradorId"]],
                    }
                )]
            await transacao(registrar_manual)
            return

        async def efetivar_estorno(c):
            atual = await repo.buscar_por_pedido(c, p["pedidoId"])
            if not atual or atual["status"] == "ESTORNADO":
                return []
            await repo.gravar_estorno(c, atual["id"], p.get("motivo", "estorno"))
            print(f"[pagamento] pedido {p['pedidoId']} estornado: {em_reais(atual['valorCentavos'])}")
            return [evento_estorno(atual, p, correlation_id, True)]

        await transacao(efetivar_estorno)

    await idempotente(evento, executar)
