import asyncio
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .config import SERVICE_NAME, PORT, RABBITMQ_URL, SUBSCRIBES, OUTBOX_POLL_INTERVAL_S
from .db import init_db, close_db, db_ok, migrate
from .messaging import (
    connect_broker, close_broker, broker_ok, subscribe,
    listar_dlq, reprocessar_dlq, descartar_dlq, contar_dlq
)
from .outbox import despachar
from .auth import Autor, exigir, exigir_adm, UUID_RE
from .meios import MEIOS_PAGAMENTO, CENTAVOS_RECUSA, estrategia_para, em_reais
from .provedor import mascarar_referencia
from .saga import tratar_pagamento_solicitado, tratar_estorno_solicitado
from . import repositorio as repo

async def roteador_eventos(evento: dict) -> None:
    tipo = evento.get("type", "")
    if tipo == "pagamento.solicitado":
        await tratar_pagamento_solicitado(evento)
    elif tipo == "estorno.solicitado":
        await tratar_estorno_solicitado(evento)

async def loop_outbox():
    while True:
        try:
            await despachar()
        except Exception as e:
            print(f"[{SERVICE_NAME}] erro no despachante da outbox: {e}")
        await asyncio.sleep(OUTBOX_POLL_INTERVAL_S)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await migrate()
    await connect_broker(RABBITMQ_URL)
    task_sub = asyncio.create_task(subscribe(SUBSCRIBES, roteador_eventos))
    task_outbox = asyncio.create_task(loop_outbox())
    yield
    task_sub.cancel()
    task_outbox.cancel()
    await close_broker()
    await close_db()

app = FastAPI(title="ArenaHub Pagamento", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    corr = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    response: Response = await call_next(request)
    response.headers["x-correlation-id"] = corr
    return response

@app.get("/health")
async def health(response: Response):
    db = await db_ok()
    broker = broker_ok()
    if not db:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "service": SERVICE_NAME,
        "status": "ok" if db else "degraded",
        "db": db,
        "broker": broker,
    }

def transacao_publica(t: dict) -> dict:
    meio = t["meio"]
    estrategia = estrategia_para(meio)
    return {
        "id": t["id"],
        "pedidoId": t["pedidoId"],
        "compradorId": t["compradorId"],
        "valorCentavos": t["valorCentavos"],
        "valor": em_reais(t["valorCentavos"]),
        "meio": t["meio"],
        "meioRotulo": estrategia.rotulo,
        "referenciaPagamento": mascarar_referencia(t["referenciaPagamento"]),
        "status": t["status"],
        "autorizacao": t.get("autorizacao"),
        "motivo": t.get("motivo"),
        "criadoEm": t["criadoEm"],
        "estornadoEm": t.get("estornadoEm"),
    }

# ---------- Metadados dos Meios e Gatilhos de Recusa ----------

@app.get("/meta/meios")
async def get_meta_meios(a: Autor = Depends(exigir)):
    meios_info = []
    for m in MEIOS_PAGAMENTO:
        e = estrategia_para(m)
        meios_info.append({
            "valor": m,
            "rotulo": e.rotulo,
            "limiteCentavos": e.limite_centavos,
            "aceitaEstorno": e.aceita_estorno(),
            "recusaSempre": m == "CARTAO_RECUSADO",
        })
    return {
        "meios": meios_info,
        "gatilhosDeRecusa": [
            {
                "gatilho": "meio de pagamento",
                "comoProvocar": 'escolher o meio "Cartão de teste (recusa sempre)"',
                "efeito": "recusa qualquer valor, sempre",
            },
            {
                "gatilho": "valor",
                "comoProvocar": f"fazer o total terminar em {CENTAVOS_RECUSA} centavos (ex.: R$ 80,66)",
                "efeito": "recusa em qualquer meio de pagamento",
            },
        ],
    }

# ---------- Consultas de Transação ----------

@app.get("/")
async def listar_transacoes(
    limite: int = Query(50, ge=1, le=200),
    a: Autor = Depends(exigir)
):
    comprador_id = None if a.papel == "ADM" else a.id
    rows = await repo.listar(comprador_id, limite=limite)
    return [transacao_publica(r) for r in rows]

@app.get("/pedido/{pedido_id}")
async def buscar_por_pedido(pedido_id: str, a: Autor = Depends(exigir)):
    if not UUID_RE.match(pedido_id):
        raise HTTPException(status_code=400, detail="pedidoId inválido")
    t = await repo.buscar_por_pedido(None, pedido_id)
    if not t:
        raise HTTPException(status_code=404, detail="nenhum pagamento para este pedido")
    if a.papel != "ADM" and t["compradorId"] != a.id:
        raise HTTPException(status_code=403, detail="você só pode consultar os seus próprios pagamentos")
    return transacao_publica(t)

@app.get("/{id}")
async def buscar_por_id(id: str, a: Autor = Depends(exigir)):
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail="id inválido")
    t = await repo.buscar_por_id(id)
    if not t:
        raise HTTPException(status_code=404, detail="transação não encontrada")
    if a.papel != "ADM" and t["compradorId"] != a.id:
        raise HTTPException(status_code=403, detail="você só pode consultar os seus próprios pagamentos")
    return transacao_publica(t)

# ---------- Administração DLQ ----------

@app.get("/dlq")
async def get_dlq(_: Autor = Depends(exigir_adm)):
    mensagens = await listar_dlq()
    total = await contar_dlq()
    return {"total": total, "mensagens": mensagens}

@app.post("/dlq/reprocessar")
async def post_reprocessar_dlq(_: Autor = Depends(exigir_adm)):
    total = await reprocessar_dlq()
    return {"reprocessadas": total}

@app.delete("/dlq")
async def delete_dlq(_: Autor = Depends(exigir_adm)):
    total = await descartar_dlq()
    return {"descartadas": total}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=PORT, log_level="info")
