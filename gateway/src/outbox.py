import asyncio
import json
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
import asyncpg
from .db import get_pool
from .messaging import publicar_envelope
from .config import SERVICE_NAME

"""
Padrão Arquitetural: TRANSACTIONAL OUTBOX.
Garante que eventos só são publicados após commit da transação correspondente.
Um loop de background (despachar) entrega os eventos pendentes de forma assíncrona.
"""

T = TypeVar("T")

class EventoSaida:
    def __init__(self, nome: str, payload: Any, correlation_id: str, versao: int = 1):
        self.nome = nome
        self.payload = payload
        self.correlation_id = correlation_id
        self.versao = versao

async def migrate_outbox() -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS eventos_saida (
                id             BIGSERIAL PRIMARY KEY,
                event_id       UUID NOT NULL UNIQUE,
                tipo           TEXT NOT NULL,
                versao         INT  NOT NULL,
                correlation_id TEXT NOT NULL,
                envelope       JSONB NOT NULL,
                criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
                publicado_em   TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS eventos_saida_pendentes
                ON eventos_saida (id) WHERE publicado_em IS NULL;
        """)

async def gravar(conn: asyncpg.Connection, ev: EventoSaida) -> None:
    event_id = uuid.uuid4()
    occurred_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    envelope = {
        "eventId": str(event_id),
        "type": ev.nome,
        "version": ev.versao,
        "occurredAt": occurred_at,
        "correlationId": ev.correlation_id,
        "producer": SERVICE_NAME,
        "payload": ev.payload
    }
    await conn.execute(
        """
        INSERT INTO eventos_saida (event_id, tipo, versao, correlation_id, envelope)
        VALUES ($1, $2, $3, $4, $5)
        """,
        event_id,
        ev.nome,
        ev.versao,
        ev.correlation_id,
        json.dumps(envelope, default=str)
    )

async def transacao_com(fn: Callable[[asyncpg.Connection], Any]) -> Any:
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            res, eventos = await fn(conn)
            for ev in eventos:
                await gravar(conn, ev)
    # Tenta despachar imediatamente após commit
    asyncio.create_task(despachar())
    return res

async def transacao(fn: Callable[[asyncpg.Connection], Any]) -> None:
    async def wrapper(conn: asyncpg.Connection):
        eventos = await fn(conn)
        return None, eventos
    await transacao_com(wrapper)

_despachando = False

async def despachar(limite: int = 100) -> int:
    global _despachando
    if _despachando:
        return 0
    _despachando = True
    total = 0
    pool = get_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, envelope FROM eventos_saida WHERE publicado_em IS NULL ORDER BY id LIMIT $1",
                limite
            )
            for r in rows:
                envelope = json.loads(r["envelope"]) if isinstance(r["envelope"], str) else r["envelope"]
                ok = await publicar_envelope(envelope)
                if not ok:
                    break
                await conn.execute(
                    "UPDATE eventos_saida SET publicado_em = now() WHERE id = $1",
                    r["id"]
                )
                total += 1
    finally:
        _despachando = False
    return total

async def pendentes() -> int:
    pool = get_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval("SELECT count(*)::int FROM eventos_saida WHERE publicado_em IS NULL")
        return val or 0

async def iniciar_relay(intervalo_s: float = 1.0) -> None:
    while True:
        try:
            await despachar()
        except Exception as e:
            print(f"[{SERVICE_NAME}] Erro no relay outbox: {e}")
        await asyncio.sleep(intervalo_s)
