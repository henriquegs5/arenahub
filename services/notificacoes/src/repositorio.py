import uuid
from typing import Optional, Dict, Any
from .db import get_pool

CAMPOS = """id, tipo, titulo, mensagem, usuario_id, evento_id, pedido_id,
            ingresso_id, criado_em, lida_em"""

def mapear(row: Any) -> Dict[str, Any]:
    return {
        "id": str(row["id"]),
        "tipo": row["tipo"],
        "titulo": row["titulo"],
        "mensagem": row["mensagem"],
        "usuarioId": str(row["usuario_id"]) if row["usuario_id"] else None,
        "eventoId": str(row["evento_id"]) if row["evento_id"] else None,
        "pedidoId": str(row["pedido_id"]) if row["pedido_id"] else None,
        "ingressoId": str(row["ingresso_id"]) if row["ingresso_id"] else None,
        "criadoEm": row["criado_em"].isoformat() if row["criado_em"] else None,
        "lidaEm": row["lida_em"].isoformat() if row["lida_em"] else None,
        "lida": row["lida_em"] is not None
    }

async def listar(usuario_id: Optional[str], apenas_nao_lidas: bool = False, limite: int = 50) -> list[Dict[str, Any]]:
    pool = get_pool()
    uid = uuid.UUID(usuario_id) if usuario_id else None
    query = f"""
        SELECT {CAMPOS}
          FROM notificacoes
         WHERE ($1::uuid IS NULL OR usuario_id = $1)
           AND ($2::boolean IS NOT TRUE OR lida_em IS NULL)
         ORDER BY criado_em DESC LIMIT $3
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, uid, apenas_nao_lidas, limite)
        return [mapear(r) for r in rows]

async def buscar(id: str) -> Optional[Dict[str, Any]]:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"SELECT {CAMPOS} FROM notificacoes WHERE id = $1", uuid.UUID(id))
        return mapear(row) if row else None

async def contar_nao_lidas(usuario_id: Optional[str]) -> int:
    pool = get_pool()
    uid = uuid.UUID(usuario_id) if usuario_id else None
    query = """
        SELECT count(*)::int AS n FROM notificacoes
         WHERE ($1::uuid IS NULL OR usuario_id = $1) AND lida_em IS NULL
    """
    async with pool.acquire() as conn:
        val = await conn.fetchval(query, uid)
        return int(val or 0)

async def marcar_lida(id: str) -> bool:
    pool = get_pool()
    async with pool.acquire() as conn:
        res = await conn.execute("UPDATE notificacoes SET lida_em = now() WHERE id = $1 AND lida_em IS NULL", uuid.UUID(id))
        return "UPDATE 1" in res

async def marcar_nao_lida(id: str) -> bool:
    pool = get_pool()
    async with pool.acquire() as conn:
        res = await conn.execute("UPDATE notificacoes SET lida_em = NULL WHERE id = $1 AND lida_em IS NOT NULL", uuid.UUID(id))
        return "UPDATE 1" in res

async def marcar_todas_lidas(usuario_id: Optional[str]) -> int:
    pool = get_pool()
    uid = uuid.UUID(usuario_id) if usuario_id else None
    async with pool.acquire() as conn:
        res = await conn.execute(
            "UPDATE notificacoes SET lida_em = now() WHERE ($1::uuid IS NULL OR usuario_id = $1) AND lida_em IS NULL",
            uid
        )
        # Formato 'UPDATE X'
        try:
            return int(res.split(" ")[1])
        except Exception:
            return 0

async def remover(id: str) -> bool:
    pool = get_pool()
    async with pool.acquire() as conn:
        res = await conn.execute("DELETE FROM notificacoes WHERE id = $1", uuid.UUID(id))
        return "DELETE 1" in res

async def remover_lidas(usuario_id: Optional[str]) -> int:
    pool = get_pool()
    uid = uuid.UUID(usuario_id) if usuario_id else None
    async with pool.acquire() as conn:
        res = await conn.execute(
            "DELETE FROM notificacoes WHERE ($1::uuid IS NULL OR usuario_id = $1) AND lida_em IS NOT NULL",
            uid
        )
        try:
            return int(res.split(" ")[1])
        except Exception:
            return 0

async def remover_do_usuario(usuario_id: str) -> int:
    pool = get_pool()
    async with pool.acquire() as conn:
        res = await conn.execute("DELETE FROM notificacoes WHERE usuario_id = $1", uuid.UUID(usuario_id))
        try:
            return int(res.split(" ")[1])
        except Exception:
            return 0

async def registrar_removido(usuario_id: str) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO usuarios_removidos (usuario_id) VALUES ($1) ON CONFLICT DO NOTHING", uuid.UUID(usuario_id))

async def esta_removido(usuario_id: str) -> bool:
    pool = get_pool()
    async with pool.acquire() as conn:
        val = await conn.fetchval("SELECT 1 FROM usuarios_removidos WHERE usuario_id = $1", uuid.UUID(usuario_id))
        return val is not None

async def marcar_processado(event_id: str) -> bool:
    pool = get_pool()
    async with pool.acquire() as conn:
        res = await conn.execute(
            "INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
            uuid.UUID(event_id)
        )
        return "INSERT 0 1" in res

async def desmarcar_processado(event_id: str) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM eventos_processados WHERE event_id = $1", uuid.UUID(event_id))
