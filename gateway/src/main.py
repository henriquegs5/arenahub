import asyncio
from contextlib import asynccontextmanager
import math
import time
import uuid
from typing import Any, Dict, Optional
import httpx
import jwt
from fastapi import FastAPI, Request, Response, HTTPException, status
from fastapi.responses import JSONResponse
import uvicorn

from .config import (
    SERVICE_NAME, PORT, DATABASE_URL, RABBITMQ_URL, SUBSCRIBES,
    JWT_SECRET, SERVICOS, CB_LIMITE_FALHAS, CB_TEMPO_ABERTO_MS, PROXY_TIMEOUT_MS
)
from .db import init_db, close_db, db_ok
from .messaging import connect_broker, close_broker, broker_ok, subscribe
from .outbox import migrate_outbox, iniciar_relay, pendentes
from .auth.usuarios import migrate, semear_admin
from .auth.rotas import router as rotas_auth
from .breaker import CircuitBreaker

breakers: Dict[str, CircuitBreaker] = {}
for name in SERVICOS.keys():
    breakers[name] = CircuitBreaker(
        limite_falhas=CB_LIMITE_FALHAS,
        tempo_aberto_ms=CB_TEMPO_ABERTO_MS,
        ao_mudar=lambda de, para, n=name: print(f"[gateway] circuito {n}: {de} -> {para}")
    )

relay_task: Optional[asyncio.Task] = None
http_client: Optional[httpx.AsyncClient] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global relay_task, http_client
    await init_db()
    await migrate()
    await migrate_outbox()
    await semear_admin()
    await connect_broker(RABBITMQ_URL)

    async def amqp_handler(event: Dict[str, Any]):
        etype = event.get("type")
        vers = event.get("version", 1)
        corr = event.get("correlationId")
        print(f"[{SERVICE_NAME}] evento {etype}.v{vers} corr={corr}")

    await subscribe(SUBSCRIBES, amqp_handler)
    relay_task = asyncio.create_task(iniciar_relay())
    http_client = httpx.AsyncClient(timeout=PROXY_TIMEOUT_MS / 1000.0)
    yield
    if http_client:
        await http_client.aclose()
    if relay_task:
        relay_task.cancel()
    await close_broker()
    await close_db()

app = FastAPI(title="ArenaHub Gateway", lifespan=lifespan)

@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    corr_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    request.state.correlation_id = corr_id
    response: Response = await call_next(request)
    response.headers["x-correlation-id"] = corr_id
    return response

# ================= Health & Status =================

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

@app.get("/status")
async def get_status():
    async def check_service(name: str, url: str) -> tuple[str, dict]:
        servico = "fora do ar"
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                r = await client.get(f"{url}/health")
                servico = "no ar" if r.is_success else "degradado"
        except Exception:
            pass
        return name, {"servico": servico, "circuito": breakers[name].nome_estado}

    resultados = await asyncio.gather(*(check_service(k, v) for k, v in SERVICOS.items()))
    return dict(resultados)

# ================= Autenticação =================
app.include_router(rotas_auth, prefix="/api/auth")

# ================= Proxy Reverso + Circuit Breaker =================

@app.api_route("/api/{service}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
@app.api_route("/api/{service}/{rest_of_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_catch_all(service: str, request: Request, rest_of_path: str = ""):
    if service not in SERVICOS:
        raise HTTPException(status_code=404, detail={"erro": "serviço não encontrado"})

    breaker = breakers[service]

    # Circuit Breaker: com circuito aberto, recusa sem sobrecarregar o serviço
    if not breaker.permitir():
        return JSONResponse(
            status_code=503,
            content={
                "erro": f"serviço {service} temporariamente indisponível",
                "circuito": breaker.nome_estado
            },
            headers={"Retry-After": str(math.ceil(CB_TEMPO_ABERTO_MS / 1000))}
        )

    # Autenticação JWT: valida o token e extrai a identidade
    auth_header = request.headers.get("authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"erro": "token ausente"})

    token = auth_header[7:].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = str(payload.get("sub", ""))
        user_role = str(payload.get("papel", ""))
    except Exception:
        return JSONResponse(status_code=401, content={"erro": "token inválido ou expirado"})

    # Prepara cabeçalhos encaminhados (remove spoofing e adiciona credenciais seguras)
    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    headers.pop("x-user-id", None)
    headers.pop("x-user-role", None)

    headers["x-user-id"] = user_id
    headers["x-user-role"] = user_role
    headers["x-correlation-id"] = getattr(request.state, "correlation_id", str(uuid.uuid4()))

    target_base = SERVICOS[service]
    subpath = f"/{rest_of_path}" if rest_of_path else "/"
    query = f"?{request.url.query}" if request.url.query else ""
    target_url = f"{target_base}{subpath}{query}"

    body = await request.body()

    client = http_client or httpx.AsyncClient(timeout=PROXY_TIMEOUT_MS / 1000.0)

    try:
        resp = await client.request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body,
            timeout=PROXY_TIMEOUT_MS / 1000.0
        )
        if resp.status_code >= 500:
            breaker.registrar_falha()
        else:
            breaker.registrar_sucesso()

        # Copia cabeçalhos da resposta
        resp_headers = {}
        for k, v in resp.headers.items():
            if k.lower() not in ("content-length", "content-encoding", "transfer-encoding"):
                resp_headers[k] = v

        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=resp_headers,
            media_type=resp.headers.get("content-type")
        )
    except Exception as e:
        breaker.registrar_falha()
        return JSONResponse(
            status_code=502,
            content={
                "erro": f"serviço {service} não respondeu",
                "circuito": breaker.nome_estado
            }
        )

if __name__ == "__main__":
    uvicorn.run("src.main:app", host="0.0.0.0", port=PORT, log_level="info")
