import asyncpg
from typing import Optional
from .config import DATABASE_URL, SERVICE_NAME

"""
Padrão GoF: SINGLETON.
Pool gerenciado único para o microsserviço de pagamento.
"""

_pool: Optional[asyncpg.Pool] = None

async def init_db() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        url = DATABASE_URL.replace("postgres://", "postgresql://")
        _pool = await asyncpg.create_pool(url, min_size=2, max_size=10)
    return _pool

def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Pool de banco de dados não inicializado")
    return _pool

async def close_db() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None

async def db_ok() -> bool:
    if _pool is None:
        return False
    try:
        async with _pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return True
    except Exception:
        return False

async def migrate() -> None:
    pool = await init_db()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS transacoes (
                id                    UUID PRIMARY KEY,
                pedido_id             UUID NOT NULL UNIQUE,
                comprador_id          UUID NOT NULL,
                valor_centavos        INT  NOT NULL CHECK (valor_centavos >= 0),
                meio                  TEXT NOT NULL,
                referencia_pagamento  TEXT NOT NULL,
                status                TEXT NOT NULL,
                identificador_externo TEXT,
                autorizacao           TEXT,
                motivo                TEXT,
                criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
                estornado_em          TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS transacoes_comprador ON transacoes (comprador_id, criado_em DESC);

            CREATE TABLE IF NOT EXISTS eventos_processados (
                event_id      UUID PRIMARY KEY,
                processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
            );

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
