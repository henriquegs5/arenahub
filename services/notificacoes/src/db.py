import asyncpg
from typing import Optional
from .config import DATABASE_URL, SERVICE_NAME

"""
Padrão GoF: SINGLETON.
Mantém uma única instância gerenciada do pool de conexões com o PostgreSQL
para todo o ciclo de vida do microsserviço.
"""

_pool: Optional[asyncpg.Pool] = None

async def init_db() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        # asyncpg suporta postgres:// ou postgresql://
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
            CREATE TABLE IF NOT EXISTS notificacoes (
                id         UUID PRIMARY KEY,
                tipo       TEXT NOT NULL,
                titulo     TEXT NOT NULL,
                mensagem   TEXT NOT NULL,
                usuario_id UUID,
                dados      JSONB NOT NULL DEFAULT '{}',
                criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS eventos_processados (
                event_id      UUID PRIMARY KEY,
                processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS evento_id  UUID;
            ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS pedido_id  UUID;
            ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS ingresso_id UUID;
            ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS lida_em TIMESTAMPTZ;

            CREATE INDEX IF NOT EXISTS notificacoes_usuario
              ON notificacoes (usuario_id, criado_em DESC);

            CREATE TABLE IF NOT EXISTS usuarios_removidos (
                usuario_id UUID PRIMARY KEY,
                removido_em TIMESTAMPTZ NOT NULL DEFAULT now()
            );

            CREATE INDEX IF NOT EXISTS notificacoes_nao_lidas
              ON notificacoes (usuario_id) WHERE lida_em IS NULL;
        """)
