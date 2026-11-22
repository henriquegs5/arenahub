import asyncpg
from typing import Optional
from .config import DATABASE_URL

"""
Padrão GoF: SINGLETON.
Pool global de conexões com o PostgreSQL usando asyncpg para o gateway_db.
"""

_pool: Optional[asyncpg.Pool] = None

async def init_db(url: Optional[str] = None) -> asyncpg.Pool:
    global _pool
    if _pool is None:
        target_url = url or DATABASE_URL
        _pool = await asyncpg.create_pool(target_url, min_size=2, max_size=10)
    return _pool

def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool não inicializado. Chame init_db() primeiro.")
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
            val = await conn.fetchval("SELECT 1")
            return val == 1
    except Exception:
        return False
