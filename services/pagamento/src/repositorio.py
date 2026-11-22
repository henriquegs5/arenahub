import uuid
from typing import Optional, Dict, Any
import asyncpg
from .db import get_pool
from .meios import MeioPagamento

CAMPOS = """id, pedido_id, comprador_id, valor_centavos, meio, referencia_pagamento,
            status, identificador_externo, autorizacao, motivo, criado_em, estornado_em"""

def mapear(r: Any) -> Dict[str, Any]:
    return {
        "id": str(r["id"]),
        "pedidoId": str(r["pedido_id"]),
        "compradorId": str(r["comprador_id"]),
        "valorCentavos": r["valor_centavos"],
        "meio": r["meio"],
        "referenciaPagamento": r["referencia_pagamento"],
        "status": r["status"],
        "identificadorExterno": r["identificador_externo"],
        "autorizacao": r["autorizacao"],
        "motivo": r["motivo"],
        "criadoEm": r["criado_em"].isoformat() if r["criado_em"] else None,
        "estornadoEm": r["estornado_em"].isoformat() if r["estornado_em"] else None,
    }

async def gravar_cobranca(
    conn: asyncpg.Connection,
    pedido_id: str,
    comprador_id: str,
    valor_centavos: int,
    meio: str,
    referencia_pagamento: str,
    status_transacao: str,
    identificador_externo: Optional[str] = None,
    autorizacao: Optional[str] = None,
    motivo: Optional[str] = None
) -> Dict[str, Any]:
    tx_id = uuid.uuid4()
    row = await conn.fetchrow(
        f"""
        INSERT INTO transacoes (id, pedido_id, comprador_id, valor_centavos, meio,
                                referencia_pagamento, status, identificador_externo, autorizacao, motivo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING {CAMPOS}
        """,
        tx_id,
        uuid.UUID(pedido_id),
        uuid.UUID(comprador_id),
        valor_centavos,
        meio,
        referencia_pagamento,
        status_transacao,
        identificador_externo,
        autorizacao,
        motivo
    )
    return mapear(row)

async def gravar_estorno(
    conn: asyncpg.Connection,
    transacao_id: str,
    motivo: str
) -> Dict[str, Any]:
    row = await conn.fetchrow(
        f"""
        UPDATE transacoes
           SET status = 'ESTORNADO',
               estornado_em = now(),
               motivo = COALESCE(motivo || ' | ' || $2, $2)
         WHERE id = $1 AND status != 'ESTORNADO'
        RETURNING {CAMPOS}
        """,
        uuid.UUID(transacao_id),
        motivo
    )
    return mapear(row) if row else None

async def buscar_por_id(id: str) -> Optional[Dict[str, Any]]:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"SELECT {CAMPOS} FROM transacoes WHERE id = $1", uuid.UUID(id))
        return mapear(row) if row else None

async def buscar_por_pedido(conn_or_none: Optional[asyncpg.Connection], pedido_id: str) -> Optional[Dict[str, Any]]:
    if conn_or_none is not None:
        row = await conn_or_none.fetchrow(f"SELECT {CAMPOS} FROM transacoes WHERE pedido_id = $1", uuid.UUID(pedido_id))
        return mapear(row) if row else None
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(f"SELECT {CAMPOS} FROM transacoes WHERE pedido_id = $1", uuid.UUID(pedido_id))
        return mapear(row) if row else None

async def listar(comprador_id: Optional[str] = None, limite: int = 50) -> list[Dict[str, Any]]:
    pool = get_pool()
    uid = uuid.UUID(comprador_id) if comprador_id else None
    query = f"""
        SELECT {CAMPOS}
          FROM transacoes
         WHERE ($1::uuid IS NULL OR comprador_id = $1)
         ORDER BY criado_em DESC LIMIT $2
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, uid, limite)
        return [mapear(r) for r in rows]

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
