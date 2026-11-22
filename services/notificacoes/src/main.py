import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from .config import SERVICE_NAME, PORT, RABBITMQ_URL, SUBSCRIBES
from .db import init_db, close_db, db_ok, migrate
from .messaging import (
    connect_broker, close_broker, broker_ok, subscribe,
    listar_dlq, reprocessar_dlq, descartar_dlq
)
from .auth import Autor, exigir, exigir_adm, UUID_RE
from .canais import CanalTela, CanalEmailAdapter, Notificador
from .observer import DespachanteEventos
from .observadores import ObservadorAvisos, ObservadorUsuarioRemovido
from . import repositorio as repo

# Configura o Padrão Observer
despachante = DespachanteEventos()
notificador = Notificador([CanalTela(), CanalEmailAdapter()])
despachante.assinar(ObservadorAvisos(notificador))
despachante.assinar(ObservadorUsuarioRemovido())

async def processar_evento(evento: dict) -> None:
    event_id = evento.get("eventId")
    tipo = evento.get("type", "")
    versao = evento.get("version", 1)
    corr = evento.get("correlationId", "")
    print(f"[{SERVICE_NAME}] evento {tipo}.v{versao} corr={corr}")

    if not event_id:
        return

    # Idempotência: só processa se ainda não foi registrado
    if not (await repo.marcar_processado(event_id)):
        return

    try:
        await despachante.notificar(evento)
    except Exception as e:
        await repo.desmarcar_processado(event_id)
        raise e

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicialização
    await migrate()
    await connect_broker(RABBITMQ_URL)
    # Assina as filas do RabbitMQ em background
    asyncio.create_task(subscribe(SUBSCRIBES, processar_evento))
    yield
    # Finalização
    await close_broker()
    await close_db()

app = FastAPI(title="ArenaHub Notificações", lifespan=lifespan)

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

def escopo(a: Autor) -> Optional[str]:
    return None if a.papel == "ADM" else a.id

async def buscar_aviso_ou_404(id: str, a: Autor) -> dict:
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail="id inválido")
    aviso = await repo.buscar(id)
    if not aviso or (a.papel != "ADM" and aviso.get("usuarioId") != a.id):
        raise HTTPException(status_code=404, detail="aviso não encontrado")
    return aviso

@app.get("/")
async def listar_geral(
    naoLidas: bool = Query(False),
    limite: int = Query(50, ge=1, le=200),
    a: Autor = Depends(exigir)
):
    return await repo.listar(escopo(a), apenas_nao_lidas=naoLidas, limite=limite)

@app.get("/minhas")
async def listar_minhas(
    naoLidas: bool = Query(False),
    limite: int = Query(50, ge=1, le=200),
    a: Autor = Depends(exigir)
):
    return await repo.listar(a.id, apenas_nao_lidas=naoLidas, limite=limite)

@app.get("/contador")
async def contador(a: Autor = Depends(exigir)):
    return {"naoLidas": await repo.contar_nao_lidas(escopo(a))}

@app.post("/lidas")
async def marcar_todas_como_lidas(a: Autor = Depends(exigir)):
    return {"marcadas": await repo.marcar_todas_lidas(escopo(a))}

@app.post("/{id}/lida")
async def marcar_como_lida(id: str, a: Autor = Depends(exigir)):
    await buscar_aviso_ou_404(id, a)
    await repo.marcar_lida(id)
    return await repo.buscar(id)

@app.post("/{id}/nao-lida")
async def marcar_como_nao_lida(id: str, a: Autor = Depends(exigir)):
    await buscar_aviso_ou_404(id, a)
    await repo.marcar_nao_lida(id)
    return await repo.buscar(id)

@app.delete("/lidas")
async def excluir_lidas(a: Autor = Depends(exigir)):
    return {"removidas": await repo.remover_lidas(escopo(a))}

@app.delete("/{id}")
async def excluir_aviso(id: str, a: Autor = Depends(exigir)):
    await buscar_aviso_ou_404(id, a)
    await repo.remover(id)
    return {"removido": id}

# ---------- Administração DLQ ----------

@app.get("/dlq")
async def get_dlq(_: Autor = Depends(exigir_adm)):
    itens = await listar_dlq()
    return {"total": len(itens), "itens": itens}

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
