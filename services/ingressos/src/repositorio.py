import json
import secrets
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
import asyncpg
from pydantic import BaseModel
from .db import get_pool
from .estados import StatusIngresso, StatusPedido

class ItemPedido(BaseModel):
    id: str
    pedido_id: str
    lote_id: str
    setor_nome: Optional[str] = None
    lote_nome: Optional[str] = None
    quantidade: int
    politica: str
    preco_unitario_centavos: int

class Pedido(BaseModel):
    id: str
    evento_id: str
    organizador_id: Optional[str] = None
    comprador_id: str
    status: StatusPedido
    total_centavos: int
    meio: str
    referencia_pagamento: str
    motivo: Optional[str] = None
    evento_nome: Optional[str] = None
    evento_data_hora: Optional[datetime] = None
    evento_local: Optional[str] = None
    expira_em: datetime
    criado_em: datetime
    atualizado_em: datetime

class Ingresso(BaseModel):
    id: str
    pedido_id: str
    evento_id: str
    organizador_id: Optional[str] = None
    titular_id: str
    codigo: str
    setor_nome: Optional[str] = None
    lote_nome: Optional[str] = None
    politica: str
    preco_centavos: int
    status: StatusIngresso
    evento_nome: Optional[str] = None
    evento_data_hora: Optional[datetime] = None
    evento_local: Optional[str] = None
    emitido_em: datetime
    validado_em: Optional[datetime] = None
    validado_por: Optional[str] = None

class LinhaHistorico(BaseModel):
    id: str
    pedido_id: str
    comando: str
    autor_id: Optional[str] = None
    dados: Dict[str, Any]
    status_apos: str
    executado_em: datetime

async def migrate() -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS pedidos (
                id                   UUID PRIMARY KEY,
                evento_id            UUID NOT NULL,
                comprador_id         UUID NOT NULL,
                status               TEXT NOT NULL,
                total_centavos       INT  NOT NULL DEFAULT 0,
                meio                 TEXT NOT NULL,
                referencia_pagamento TEXT NOT NULL,
                motivo               TEXT,
                evento_nome          TEXT,
                evento_data_hora     TIMESTAMPTZ,
                evento_local         TEXT,
                expira_em            TIMESTAMPTZ NOT NULL,
                criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
                atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS pedidos_comprador ON pedidos (comprador_id, criado_em DESC);
            CREATE INDEX IF NOT EXISTS pedidos_evento ON pedidos (evento_id);
            CREATE INDEX IF NOT EXISTS pedidos_em_andamento ON pedidos (expira_em)
                WHERE status IN ('PENDENTE','RESERVADO','AGUARDANDO_PAGAMENTO');

            CREATE TABLE IF NOT EXISTS pedido_itens (
                id                      UUID PRIMARY KEY,
                pedido_id               UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
                lote_id                 UUID NOT NULL,
                setor_nome              TEXT,
                lote_nome               TEXT,
                quantidade              INT  NOT NULL CHECK (quantidade > 0),
                politica                TEXT NOT NULL,
                preco_unitario_centavos INT  NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS pedido_itens_pedido ON pedido_itens (pedido_id);

            CREATE TABLE IF NOT EXISTS ingressos (
                id               UUID PRIMARY KEY,
                pedido_id        UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
                evento_id        UUID NOT NULL,
                titular_id       UUID NOT NULL,
                codigo           TEXT NOT NULL UNIQUE,
                setor_nome       TEXT,
                lote_nome        TEXT,
                politica         TEXT NOT NULL,
                preco_centavos   INT  NOT NULL DEFAULT 0,
                status           TEXT NOT NULL,
                evento_nome      TEXT,
                evento_data_hora TIMESTAMPTZ,
                evento_local     TEXT,
                emitido_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
                validado_em      TIMESTAMPTZ,
                validado_por     UUID
            );
            CREATE INDEX IF NOT EXISTS ingressos_titular ON ingressos (titular_id, emitido_em DESC);
            CREATE INDEX IF NOT EXISTS ingressos_evento ON ingressos (evento_id);

            CREATE TABLE IF NOT EXISTS pedido_historico (
                id           UUID PRIMARY KEY,
                pedido_id    UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
                comando      TEXT NOT NULL,
                autor_id     UUID,
                dados        JSONB NOT NULL DEFAULT '{}',
                status_apos  TEXT NOT NULL,
                executado_em TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS pedido_historico_pedido ON pedido_historico (pedido_id, executado_em);

            ALTER TABLE pedidos   ADD COLUMN IF NOT EXISTS organizador_id UUID;
            ALTER TABLE ingressos ADD COLUMN IF NOT EXISTS organizador_id UUID;
            CREATE INDEX IF NOT EXISTS pedidos_organizador   ON pedidos (organizador_id);
            CREATE INDEX IF NOT EXISTS ingressos_organizador ON ingressos (organizador_id);

            CREATE TABLE IF NOT EXISTS eventos_processados (
                event_id      UUID PRIMARY KEY,
                processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        """)

def map_pedido(r: Any) -> Pedido:
    return Pedido(
        id=str(r["id"]),
        evento_id=str(r["evento_id"]),
        organizador_id=str(r["organizador_id"]) if r["organizador_id"] else None,
        comprador_id=str(r["comprador_id"]),
        status=r["status"],
        total_centavos=r["total_centavos"],
        meio=r["meio"],
        referencia_pagamento=r["referencia_pagamento"],
        motivo=r["motivo"],
        evento_nome=r["evento_nome"],
        evento_data_hora=r["evento_data_hora"],
        evento_local=r["evento_local"],
        expira_em=r["expira_em"],
        criado_em=r["criado_em"],
        atualizado_em=r["atualizado_em"],
    )

def map_item(r: Any) -> ItemPedido:
    return ItemPedido(
        id=str(r["id"]),
        pedido_id=str(r["pedido_id"]),
        lote_id=str(r["lote_id"]),
        setor_nome=r["setor_nome"],
        lote_nome=r["lote_nome"],
        quantidade=r["quantidade"],
        politica=r["politica"],
        preco_unitario_centavos=r["preco_unitario_centavos"],
    )

def map_ingresso(r: Any) -> Ingresso:
    return Ingresso(
        id=str(r["id"]),
        pedido_id=str(r["pedido_id"]),
        evento_id=str(r["evento_id"]),
        organizador_id=str(r["organizador_id"]) if r["organizador_id"] else None,
        titular_id=str(r["titular_id"]),
        codigo=r["codigo"],
        setor_nome=r["setor_nome"],
        lote_nome=r["lote_nome"],
        politica=r["politica"],
        preco_centavos=r["preco_centavos"],
        status=r["status"],
        evento_nome=r["evento_nome"],
        evento_data_hora=r["evento_data_hora"],
        evento_local=r["evento_local"],
        emitido_em=r["emitido_em"],
        validado_em=r["validado_em"],
        validado_por=str(r["validado_por"]) if r["validado_por"] else None,
    )

def map_historico(r: Any) -> LinhaHistorico:
    dados_val = r["dados"]
    dados = json.loads(dados_val) if isinstance(dados_val, str) else dados_val
    return LinhaHistorico(
        id=str(r["id"]),
        pedido_id=str(r["pedido_id"]),
        comando=r["comando"],
        autor_id=str(r["autor_id"]) if r["autor_id"] else None,
        dados=dados or {},
        status_apos=r["status_apos"],
        executado_em=r["executado_em"],
    )

# ---------- Pedidos ----------

def gerar_codigo() -> str:
    alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    b1 = "".join(secrets.choice(alfabeto) for _ in range(4))
    b2 = "".join(secrets.choice(alfabeto) for _ in range(4))
    b3 = "".join(secrets.choice(alfabeto) for _ in range(4))
    return f"ARENA-{b1}-{b2}-{b3}"

async def criar_pedido(conn: asyncpg.Connection, p: dict) -> Pedido:
    novo_id = uuid.uuid4()
    r = await conn.fetchrow(
        """
        INSERT INTO pedidos (id, evento_id, comprador_id, status, meio, referencia_pagamento, expira_em)
        VALUES ($1, $2, $3, 'PENDENTE', $4, $5, $6)
        RETURNING *
        """,
        novo_id,
        uuid.UUID(p["eventoId"]),
        uuid.UUID(p["compradorId"]),
        p["meio"],
        p["referenciaPagamento"],
        p["expiraEm"]
    )
    for item in p["itens"]:
        await conn.execute(
            """
            INSERT INTO pedido_itens (id, pedido_id, lote_id, quantidade, politica)
            VALUES ($1, $2, $3, $4, $5)
            """,
            uuid.uuid4(),
            novo_id,
            uuid.UUID(item["loteId"]),
            item["quantidade"],
            item["politica"]
        )
    return map_pedido(r)

async def buscar_pedido(
    conn: Optional[asyncpg.Connection], id: str, travar: bool = False
) -> Optional[Pedido]:
    lock = " FOR UPDATE" if travar else ""
    sql = f"SELECT * FROM pedidos WHERE id = $1{lock}"
    uid = uuid.UUID(id)
    if conn:
        r = await conn.fetchrow(sql, uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            r = await c.fetchrow(sql, uid)
    return map_pedido(r) if r else None

async def itens_do_pedido(conn: Optional[asyncpg.Connection], pedido_id: str) -> list[ItemPedido]:
    sql = "SELECT * FROM pedido_itens WHERE pedido_id = $1 ORDER BY id"
    uid = uuid.UUID(pedido_id)
    if conn:
        rows = await conn.fetch(sql, uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            rows = await c.fetch(sql, uid)
    return [map_item(r) for r in rows]

async def atualizar_status_pedido(
    conn: asyncpg.Connection, id: str, status: str, motivo: Optional[str] = None
) -> None:
    await conn.execute(
        """
        UPDATE pedidos SET status = $2, motivo = COALESCE($3, motivo), atualizado_em = now()
        WHERE id = $1
        """,
        uuid.UUID(id),
        status,
        motivo
    )

async def aplicar_reserva(
    conn: asyncpg.Connection, pedido_id: str, dados: dict
) -> None:
    dt = None
    if dados.get("eventoDataHora"):
        try:
            dt = datetime.fromisoformat(str(dados["eventoDataHora"]).replace("Z", "+00:00"))
        except Exception:
            pass

    org_uid = uuid.UUID(dados["organizadorId"]) if dados.get("organizadorId") else None

    await conn.execute(
        """
        UPDATE pedidos SET
            total_centavos = $2,
            evento_nome = $3,
            evento_data_hora = $4,
            evento_local = $5,
            organizador_id = COALESCE($6, organizador_id),
            atualizado_em = now()
        WHERE id = $1
        """,
        uuid.UUID(pedido_id),
        dados["totalCentavos"],
        dados["eventoNome"],
        dt,
        dados["eventoLocal"],
        org_uid
    )

    for item in dados.get("itens", []):
        await conn.execute(
            """
            UPDATE pedido_itens SET
                setor_nome = $3,
                lote_nome = $4,
                preco_unitario_centavos = $5
            WHERE pedido_id = $1 AND lote_id = $2
            """,
            uuid.UUID(pedido_id),
            uuid.UUID(item["loteId"]),
            item["setorNome"],
            item["loteNome"],
            item["precoUnitarioCentavos"]
        )

async def listar_pedidos(
    comprador_id: Optional[str] = None,
    organizador_id: Optional[str] = None,
    evento_id: Optional[str] = None,
    status: Optional[str] = None,
    limite: int = 50,
    conn: Optional[asyncpg.Connection] = None
) -> list[Pedido]:
    sql = """
        SELECT * FROM pedidos
        WHERE ($1::uuid IS NULL OR comprador_id = $1)
          AND ($2::uuid IS NULL OR evento_id = $2)
          AND ($3::text IS NULL OR status = $3)
          AND ($5::uuid IS NULL OR organizador_id = $5)
        ORDER BY criado_em DESC LIMIT $4
    """
    comp_uid = uuid.UUID(comprador_id) if comprador_id else None
    ev_uid = uuid.UUID(evento_id) if evento_id else None
    org_uid = uuid.UUID(organizador_id) if organizador_id else None

    if conn:
        rows = await conn.fetch(sql, comp_uid, ev_uid, status, limite, org_uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            rows = await c.fetch(sql, comp_uid, ev_uid, status, limite, org_uid)
    return [map_pedido(r) for r in rows]

async def pedidos_expirados(conn: asyncpg.Connection, limite: int = 50) -> list[Pedido]:
    rows = await conn.fetch(
        """
        SELECT * FROM pedidos
        WHERE status IN ('PENDENTE','RESERVADO','AGUARDANDO_PAGAMENTO')
          AND expira_em < now()
        ORDER BY expira_em
        LIMIT $1
        FOR UPDATE SKIP LOCKED
        """,
        limite
    )
    return [map_pedido(r) for r in rows]

async def quantidade_ja_pedida(conn: asyncpg.Connection, evento_id: str, comprador_id: str) -> int:
    val = await conn.fetchval(
        """
        SELECT COALESCE(SUM(i.quantidade), 0)::int
        FROM pedido_itens i
        JOIN pedidos p ON p.id = i.pedido_id
        WHERE p.evento_id = $1 AND p.comprador_id = $2
          AND p.status NOT IN ('CANCELADO','EXPIRADO','RECUSADO')
        """,
        uuid.UUID(evento_id),
        uuid.UUID(comprador_id)
    )
    return val or 0

async def tem_pedido_em_andamento(conn: asyncpg.Connection, evento_id: str, comprador_id: str) -> bool:
    r = await conn.fetchrow(
        """
        SELECT 1 FROM pedidos
        WHERE evento_id = $1 AND comprador_id = $2
          AND status IN ('PENDENTE','RESERVADO','AGUARDANDO_PAGAMENTO')
        LIMIT 1
        """,
        uuid.UUID(evento_id),
        uuid.UUID(comprador_id)
    )
    return r is not None

# ---------- Ingressos ----------

async def emitir_ingresso(conn: asyncpg.Connection, d: dict) -> Ingresso:
    dt = None
    if d.get("eventoDataHora"):
        if isinstance(d["eventoDataHora"], datetime):
            dt = d["eventoDataHora"]
        else:
            try:
                dt = datetime.fromisoformat(str(d["eventoDataHora"]).replace("Z", "+00:00"))
            except Exception:
                pass

    org_uid = uuid.UUID(d["organizadorId"]) if d.get("organizadorId") else None

    for _ in range(5):
        try:
            r = await conn.fetchrow(
                """
                INSERT INTO ingressos
                   (id, pedido_id, evento_id, titular_id, codigo, setor_nome, lote_nome, politica,
                    preco_centavos, status, evento_nome, evento_data_hora, evento_local, organizador_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'EMITIDO',$10,$11,$12,$13) RETURNING *
                """,
                uuid.uuid4(),
                uuid.UUID(d["pedidoId"]),
                uuid.UUID(d["eventoId"]),
                uuid.UUID(d["titularId"]),
                gerar_codigo(),
                d.get("setorNome"),
                d.get("loteNome"),
                d["politica"],
                d["precoCentavos"],
                d.get("eventoNome"),
                dt,
                d.get("eventoLocal"),
                org_uid
            )
            return map_ingresso(r)
        except asyncpg.UniqueViolationError:
            continue
    raise RuntimeError("não foi possível gerar um código único para o ingresso")

async def ingressos_do_pedido(conn: Optional[asyncpg.Connection], pedido_id: str) -> list[Ingresso]:
    sql = "SELECT * FROM ingressos WHERE pedido_id = $1 ORDER BY emitido_em"
    uid = uuid.UUID(pedido_id)
    if conn:
        rows = await conn.fetch(sql, uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            rows = await c.fetch(sql, uid)
    return [map_ingresso(r) for r in rows]

async def buscar_ingresso(conn: Optional[asyncpg.Connection], id: str, travar: bool = False) -> Optional[Ingresso]:
    lock = " FOR UPDATE" if travar else ""
    sql = f"SELECT * FROM ingressos WHERE id = $1{lock}"
    uid = uuid.UUID(id)
    if conn:
        r = await conn.fetchrow(sql, uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            r = await c.fetchrow(sql, uid)
    return map_ingresso(r) if r else None

async def buscar_ingresso_por_codigo(
    conn: Optional[asyncpg.Connection], codigo: str, travar: bool = False
) -> Optional[Ingresso]:
    lock = " FOR UPDATE" if travar else ""
    sql = f"SELECT * FROM ingressos WHERE codigo = $1{lock}"
    code_clean = codigo.strip().upper()
    if conn:
        r = await conn.fetchrow(sql, code_clean)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            r = await c.fetchrow(sql, code_clean)
    return map_ingresso(r) if r else None

async def atualizar_status_ingresso(conn: asyncpg.Connection, id: str, status: str) -> None:
    await conn.execute("UPDATE ingressos SET status = $2 WHERE id = $1", uuid.UUID(id), status)

async def registrar_entrada(conn: Optional[asyncpg.Connection], id: str, validado_por: str) -> bool:
    sql = """
        UPDATE ingressos SET status = 'UTILIZADO', validado_em = now(), validado_por = $2
        WHERE id = $1 AND status = 'EMITIDO'
    """
    uid = uuid.UUID(id)
    val_uid = uuid.UUID(validado_por)
    if conn:
        res = await conn.execute(sql, uid, val_uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            res = await c.execute(sql, uid, val_uid)
    return res != "UPDATE 0"

async def listar_ingressos(
    titular_id: Optional[str] = None,
    organizador_id: Optional[str] = None,
    evento_id: Optional[str] = None,
    status: Optional[str] = None,
    limite: int = 50,
    conn: Optional[asyncpg.Connection] = None
) -> list[Ingresso]:
    sql = """
        SELECT * FROM ingressos
        WHERE ($1::uuid IS NULL OR titular_id = $1)
          AND ($2::uuid IS NULL OR evento_id = $2)
          AND ($3::text IS NULL OR status = $3)
          AND ($5::uuid IS NULL OR organizador_id = $5)
        ORDER BY emitido_em DESC LIMIT $4
    """
    tit_uid = uuid.UUID(titular_id) if titular_id else None
    ev_uid = uuid.UUID(evento_id) if evento_id else None
    org_uid = uuid.UUID(organizador_id) if organizador_id else None

    if conn:
        rows = await conn.fetch(sql, tit_uid, ev_uid, status, limite, org_uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            rows = await c.fetch(sql, tit_uid, ev_uid, status, limite, org_uid)
    return [map_ingresso(r) for r in rows]

# ---------- Histórico (Command) ----------

async def registrar_historico(
    conn: asyncpg.Connection,
    pedido_id: str,
    comando: str,
    autor_id: Optional[str],
    dados: dict,
    status_apos: str
) -> None:
    aut_uid = uuid.UUID(autor_id) if autor_id else None
    await conn.execute(
        """
        INSERT INTO pedido_historico (id, pedido_id, comando, autor_id, dados, status_apos)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        uuid.uuid4(),
        uuid.UUID(pedido_id),
        comando,
        aut_uid,
        json.dumps(dados, default=str),
        status_apos
    )

async def historico_do_pedido(conn: Optional[asyncpg.Connection], pedido_id: str) -> list[LinhaHistorico]:
    sql = "SELECT * FROM pedido_historico WHERE pedido_id = $1 ORDER BY executado_em, id"
    uid = uuid.UUID(pedido_id)
    if conn:
        rows = await conn.fetch(sql, uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            rows = await c.fetch(sql, uid)
    return [map_historico(r) for r in rows]

# ---------- Idempotência ----------

async def marcar_processado(event_id: str) -> bool:
    pool = get_pool()
    async with pool.acquire() as conn:
        res = await conn.execute(
            "INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
            uuid.UUID(event_id)
        )
        return res != "INSERT 0 0"

async def desmarcar_processado(event_id: str) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM eventos_processados WHERE event_id = $1", uuid.UUID(event_id))
