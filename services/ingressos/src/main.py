import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional
import uuid
from fastapi import FastAPI, Request, Response, HTTPException, status, Query
from fastapi.responses import JSONResponse
import uvicorn
from pydantic import BaseModel

from .config import (
    SERVICE_NAME, PORT, DATABASE_URL, RABBITMQ_URL, SUBSCRIBES,
    LIMITE_POR_COMPRADOR, PEDIDO_EXPIRA_SEGUNDOS, EXPIRACAO_INTERVALO_MS
)
from .db import init_db, close_db, db_ok, get_pool
from .messaging import (
    connect_broker, close_broker, broker_ok, subscribe,
    contar_dlq, listar_dlq, reprocessar_dlq, descartar_dlq
)
from .outbox import migrate_outbox, iniciar_relay, pendentes
from .repositorio import (
    migrate, buscar_pedido, itens_do_pedido, ingressos_do_pedido,
    buscar_ingresso, listar_pedidos, listar_ingressos, historico_do_pedido
)
from .estados import STATUS_PEDIDO, StatusPedido, StatusIngresso, TransicaoInvalida, estado_pedido
from .meios import MEIOS_PAGAMENTO, em_reais
from .auth import exigir, exigir_adm, quem, UUID_RE, Autor
from .servico import ErroNegocio
from . import servico

relay_task: Optional[asyncio.Task] = None
sweeper_task: Optional[asyncio.Task] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global relay_task, sweeper_task
    await init_db()
    await migrate()
    await migrate_outbox()
    await connect_broker(RABBITMQ_URL)

    async def amqp_handler(event: Dict[str, Any]):
        etype = event.get("type")
        corr = event.get("correlationId")
        vers = event.get("version", 1)
        print(f"[{SERVICE_NAME}] evento {etype}.v{vers} corr={corr}")
        match etype:
            case "lugares.reservados":
                await servico.tratar_lugares_reservados(event)
            case "reserva.recusada":
                await servico.tratar_reserva_recusada(event)
            case "pagamento.aprovado":
                await servico.tratar_pagamento_aprovado(event)
            case "pagamento.recusado":
                await servico.tratar_pagamento_recusado(event)
            case "estorno.concluido":
                await servico.tratar_estorno_concluido(event)
            case "evento.cancelado":
                await servico.tratar_evento_cancelado(event)
            case "evento.alterado":
                await servico.tratar_evento_alterado(event)
            case "usuario.removido":
                await servico.tratar_usuario_removido(event)

    await subscribe(SUBSCRIBES, amqp_handler)
    relay_task = asyncio.create_task(iniciar_relay())
    sweeper_task = asyncio.create_task(servico.iniciar_varredor(EXPIRACAO_INTERVALO_MS / 1000.0))
    yield
    if sweeper_task:
        sweeper_task.cancel()
    if relay_task:
        relay_task.cancel()
    await close_broker()
    await close_db()

app = FastAPI(title="ArenaHub Ingressos", lifespan=lifespan)

@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    request.state.correlation_id = correlation_id
    response: Response = await call_next(request)
    response.headers["x-correlation-id"] = correlation_id
    return response

@app.exception_handler(ErroNegocio)
async def erro_negocio_handler(request: Request, exc: ErroNegocio):
    return JSONResponse(status_code=exc.status, content={"erro": exc.mensagem})

@app.exception_handler(TransicaoInvalida)
async def transicao_invalida_handler(request: Request, exc: TransicaoInvalida):
    return JSONResponse(status_code=409, content={"erro": str(exc)})

# ================= Health =================

@app.get("/health")
async def health():
    db = await db_ok()
    outbox = await pendentes() if db else -1
    return JSONResponse(
        status_code=200 if db else 503,
        content={
            "service": SERVICE_NAME,
            "status": "ok" if db else "degraded",
            "db": db,
            "broker": broker_ok(),
            "eventosPendentes": outbox,
        }
    )

# ================= DLQ (ADM) =================

@app.get("/dlq")
async def get_dlq(request: Request):
    exigir_adm(request)
    return {"total": await contar_dlq(), "mensagens": await listar_dlq(50)}

@app.post("/dlq/reprocessar")
async def post_reprocessar_dlq(request: Request):
    exigir_adm(request)
    return {"reprocessadas": await reprocessar_dlq(50)}

@app.delete("/dlq")
async def delete_dlq(request: Request):
    exigir_adm(request)
    return {"descartadas": await descartar_dlq()}

# ================= Apresentação & Escopo =================

def pode_ver_pedido(a: Autor, p: servico.repo.Pedido) -> bool:
    return (
        a.papel == "ADM" or
        p.comprador_id == a.id or
        (a.papel == "ORGANIZADOR" and p.organizador_id == a.id)
    )

def pode_ver_ingresso(a: Autor, i: servico.repo.Ingresso) -> bool:
    return (
        a.papel == "ADM" or
        i.titular_id == a.id or
        (a.papel == "ORGANIZADOR" and i.organizador_id == a.id)
    )

def ingresso_publico(i: servico.repo.Ingresso) -> dict:
    return {
        "id": i.id,
        "pedidoId": i.pedido_id,
        "eventoId": i.evento_id,
        "titularId": i.titular_id,
        "codigo": i.codigo,
        "setorNome": i.setor_nome,
        "loteNome": i.lote_nome,
        "politica": i.politica,
        "precoCentavos": i.preco_centavos,
        "preco": em_reais(i.preco_centavos),
        "status": i.status,
        "eventoNome": i.evento_nome,
        "eventoDataHora": i.evento_data_hora.isoformat() if i.evento_data_hora else None,
        "eventoLocal": i.evento_local,
        "emitidoEm": i.emitido_em.isoformat() if i.emitido_em else None,
        "validadoEm": i.validado_em.isoformat() if i.validado_em else None,
        "validadoPor": i.validado_por,
    }

def pedido_publico(
    p: servico.repo.Pedido,
    itens: list[servico.repo.ItemPedido],
    ingressos: list[servico.repo.Ingresso] = []
) -> dict:
    return {
        "id": p.id,
        "eventoId": p.evento_id,
        "compradorId": p.comprador_id,
        "status": p.status,
        "emAndamento": estado_pedido(p.status).em_andamento(),
        "podeCancelar": estado_pedido(p.status).aceita_cancelamento(),
        "totalCentavos": p.total_centavos,
        "total": em_reais(p.total_centavos),
        "meio": p.meio,
        "motivo": p.motivo,
        "eventoNome": p.evento_nome,
        "eventoDataHora": p.evento_data_hora.isoformat() if p.evento_data_hora else None,
        "eventoLocal": p.evento_local,
        "expiraEm": p.expira_em.isoformat() if p.expira_em else None,
        "criadoEm": p.criado_em.isoformat() if p.criado_em else None,
        "atualizadoEm": p.atualizado_em.isoformat() if p.atualizado_em else None,
        "itens": [
            {
                "loteId": i.lote_id,
                "setorNome": i.setor_nome,
                "loteNome": i.lote_nome,
                "quantidade": i.quantidade,
                "politica": i.politica,
                "precoUnitarioCentavos": i.preco_unitario_centavos,
                "precoUnitario": em_reais(i.preco_unitario_centavos),
            }
            for i in itens
        ],
        "ingressos": [ingresso_publico(ing) for ing in ingressos],
    }

# ================= Metadados =================

@app.get("/meta/regras")
async def get_regras(request: Request):
    exigir(request)
    return {
        "meios": MEIOS_PAGAMENTO,
        "limitePorComprador": LIMITE_POR_COMPRADOR,
        "pedidoExpiraSegundos": PEDIDO_EXPIRA_SEGUNDOS,
    }

# ================= Pedidos =================

@app.post("/pedidos", status_code=202)
async def criar_pedido_endpoint(request: Request):
    a = exigir(request)
    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    evento_id = corpo.get("eventoId")
    itens = corpo.get("itens")
    meio = corpo.get("meio")
    referencia = corpo.get("referenciaPagamento")

    if not evento_id or not UUID_RE.match(evento_id):
        raise HTTPException(status_code=400, detail={"erro": "eventoId inválido"})
    if not isinstance(itens, list):
        raise HTTPException(status_code=400, detail={"erro": "informe os itens da compra"})

    for i in itens:
        if not UUID_RE.match(str(i.get("loteId", ""))):
            raise HTTPException(status_code=400, detail={"erro": "loteId inválido"})
        if not isinstance(i.get("politica"), str):
            raise HTTPException(status_code=400, detail={"erro": "política de preço inválida"})

    corr_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
    pedido = await servico.solicitar_compra(
        {
            "eventoId": evento_id,
            "itens": [
                {"loteId": i["loteId"], "quantidade": i["quantidade"], "politica": i["politica"]}
                for i in itens
            ],
            "meio": str(meio or ""),
            "referenciaPagamento": str(referencia or ""),
        },
        a,
        corr_id
    )

    itens_ped = await itens_do_pedido(None, pedido.id)
    completo = pedido_publico(pedido, itens_ped)
    completo["mensagem"] = "pedido recebido; os lugares estão sendo reservados e o pagamento processado"
    return completo

@app.get("/pedidos")
async def listar_pedidos_endpoint(
    request: Request,
    status_filtro: Optional[str] = Query(None, alias="status"),
    evento_id: Optional[str] = Query(None, alias="eventoId"),
    limite: int = Query(50)
):
    a = exigir(request)
    if status_filtro and status_filtro not in STATUS_PEDIDO:
        raise HTTPException(status_code=400, detail={"erro": "status inválido"})
    if evento_id and not UUID_RE.match(evento_id):
        raise HTTPException(status_code=400, detail={"erro": "eventoId inválido"})

    lim = min(max(limite, 1), 200)

    if a.papel == "ADM":
        comprador_id, organizador_id = None, None
    elif a.papel == "ORGANIZADOR":
        comprador_id, organizador_id = None, a.id
    else:
        comprador_id, organizador_id = a.id, None

    pedidos = await listar_pedidos(
        comprador_id=comprador_id,
        organizador_id=organizador_id,
        evento_id=evento_id,
        status=status_filtro,
        limite=lim
    )

    completos = []
    for p in pedidos:
        it = await itens_do_pedido(None, p.id)
        ing = await ingressos_do_pedido(None, p.id)
        completos.append(pedido_publico(p, it, ing))

    return completos

@app.get("/pedidos/{id}")
async def obter_pedido_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    p = await buscar_pedido(None, id)
    if not p:
        raise HTTPException(status_code=404, detail={"erro": "pedido não encontrado"})
    if not pode_ver_pedido(a, p):
        raise HTTPException(status_code=403, detail={"erro": "você só pode ver os seus próprios pedidos"})

    it = await itens_do_pedido(None, id)
    ing = await ingressos_do_pedido(None, id)
    return pedido_publico(p, it, ing)

@app.get("/pedidos/{id}/historico")
async def obter_historico_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    p = await buscar_pedido(None, id)
    if not p:
        raise HTTPException(status_code=404, detail={"erro": "pedido não encontrado"})
    if not pode_ver_pedido(a, p):
        raise HTTPException(status_code=403, detail={"erro": "você só pode ver os seus próprios pedidos"})

    linhas = await historico_do_pedido(None, id)
    return [
        {
            "id": h.id,
            "pedidoId": h.pedido_id,
            "comando": h.comando,
            "autorId": h.autor_id,
            "dados": h.dados,
            "statusApos": h.status_apos,
            "executadoEm": h.executado_em.isoformat(),
        }
        for h in linhas
    ]

@app.post("/pedidos/{id}/cancelar")
async def cancelar_pedido_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    motivo = str(corpo.get("motivo", "")).strip()
    corr_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
    await servico.cancelar(id, a, motivo, corr_id)

    p = await buscar_pedido(None, id)
    it = await itens_do_pedido(None, id)
    ing = await ingressos_do_pedido(None, id)
    return pedido_publico(p, it, ing)

# ================= Ingressos =================

@app.get("/")
async def listar_ingressos_endpoint(
    request: Request,
    status_filtro: Optional[str] = Query(None, alias="status"),
    evento_id: Optional[str] = Query(None, alias="eventoId"),
    limite: int = Query(50)
):
    a = exigir(request)
    if evento_id and not UUID_RE.match(evento_id):
        raise HTTPException(status_code=400, detail={"erro": "eventoId inválido"})

    lim = min(max(limite, 1), 200)

    if a.papel == "ADM":
        titular_id, organizador_id = None, None
    elif a.papel == "ORGANIZADOR":
        titular_id, organizador_id = None, a.id
    else:
        titular_id, organizador_id = a.id, None

    ingressos = await listar_ingressos(
        titular_id=titular_id,
        organizador_id=organizador_id,
        evento_id=evento_id,
        status=status_filtro,
        limite=lim
    )
    return [ingresso_publico(i) for i in ingressos]

@app.get("/{id}")
async def obter_ingresso_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    i = await buscar_ingresso(None, id)
    if not i:
        raise HTTPException(status_code=404, detail={"erro": "ingresso não encontrado"})
    if not pode_ver_ingresso(a, i):
        raise HTTPException(status_code=403, detail={"erro": "você só pode ver os seus próprios ingressos"})

    return ingresso_publico(i)

@app.post("/{id}/cancelar")
async def cancelar_ingresso_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})

    corr_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
    atualizado = await servico.cancelar_ingresso(id, a, corr_id)
    return ingresso_publico(atualizado)

# ================= Validação na Entrada (Check-in) =================

@app.post("/validar")
async def validar_entrada_endpoint(request: Request):
    a = exigir(request)
    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    codigo = str(corpo.get("codigo", "")).strip()
    if len(codigo) < 4:
        raise HTTPException(status_code=400, detail={"erro": "informe o código do ingresso"})

    corr_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))
    r = await servico.validar_entrada(codigo, a, corr_id)
    return {
        "aprovado": r.aprovado,
        "motivo": r.motivo,
        "ingresso": ingresso_publico(r.ingresso) if r.ingresso else None,
    }

if __name__ == "__main__":
    uvicorn.run("src.main:app", host="0.0.0.0", port=PORT, log_level="info")
