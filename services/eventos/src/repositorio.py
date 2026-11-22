import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
import asyncpg
from pydantic import BaseModel
from .db import get_pool
from .estados import StatusEvento
from .estrutura import EventoComposto, Lote, Setor
from .precos import PoliticaPreco

class Evento(BaseModel):
    id: str
    nome: str
    descricao: Optional[str] = None
    data_hora: datetime
    local: str
    status: StatusEvento
    organizador_id: str
    motivo_cancelamento: Optional[str] = None
    criado_em: datetime

class LinhaSetor(BaseModel):
    id: str
    evento_id: str
    nome: str
    descricao: Optional[str] = None

class DadosEvento(BaseModel):
    nome: str
    descricao: Optional[str] = None
    data_hora: datetime
    local: str

class DadosLote(BaseModel):
    nome: str
    preco_centavos: int
    desconto_percentual: int = 0
    politica_padrao: PoliticaPreco = "INTEIRA"
    capacidade: int
    inicio_vendas: Optional[datetime] = None
    fim_vendas: Optional[datetime] = None
    ativo: bool = True

class ItemReservado(BaseModel):
    lote_id: str
    quantidade: int

class Reserva(BaseModel):
    pedido_id: str
    evento_id: str
    itens: list[Dict[str, Any]]
    total_centavos: int
    status: str

async def migrate() -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS eventos (
                id                  UUID PRIMARY KEY,
                nome                TEXT NOT NULL,
                descricao           TEXT,
                data_hora           TIMESTAMPTZ NOT NULL,
                local               TEXT NOT NULL,
                status              TEXT NOT NULL,
                organizador_id      UUID NOT NULL,
                motivo_cancelamento TEXT,
                criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
            );

            CREATE TABLE IF NOT EXISTS setores (
                id        UUID PRIMARY KEY,
                evento_id UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
                nome      TEXT NOT NULL,
                descricao TEXT,
                criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS setores_evento ON setores (evento_id);

            CREATE TABLE IF NOT EXISTS lotes (
                id                  UUID PRIMARY KEY,
                setor_id            UUID NOT NULL REFERENCES setores(id) ON DELETE CASCADE,
                nome                TEXT NOT NULL,
                preco_centavos      INT  NOT NULL CHECK (preco_centavos >= 0),
                desconto_percentual INT  NOT NULL DEFAULT 0 CHECK (desconto_percentual BETWEEN 0 AND 100),
                politica_padrao     TEXT NOT NULL DEFAULT 'INTEIRA',
                capacidade          INT  NOT NULL CHECK (capacidade >= 0),
                reservados          INT  NOT NULL DEFAULT 0 CHECK (reservados >= 0),
                inicio_vendas       TIMESTAMPTZ,
                fim_vendas          TIMESTAMPTZ,
                ativo               BOOLEAN NOT NULL DEFAULT TRUE,
                criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
                CONSTRAINT lotes_nao_estoura CHECK (reservados <= capacidade)
            );
            CREATE INDEX IF NOT EXISTS lotes_setor ON lotes (setor_id);

            CREATE TABLE IF NOT EXISTS reservas (
                pedido_id      UUID PRIMARY KEY,
                evento_id      UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
                itens          JSONB NOT NULL,
                total_centavos INT NOT NULL DEFAULT 0,
                status         TEXT NOT NULL,
                criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
                liberado_em    TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS reservas_evento ON reservas (evento_id);

            CREATE TABLE IF NOT EXISTS eventos_processados (
                event_id      UUID PRIMARY KEY,
                processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        """)

def map_evento(r: Any) -> Evento:
    return Evento(
        id=str(r["id"]),
        nome=r["nome"],
        descricao=r["descricao"],
        data_hora=r["data_hora"],
        local=r["local"],
        status=r["status"],
        organizador_id=str(r["organizador_id"]),
        motivo_cancelamento=r["motivo_cancelamento"],
        criado_em=r["criado_em"],
    )

def map_setor(r: Any) -> LinhaSetor:
    return LinhaSetor(
        id=str(r["id"]),
        evento_id=str(r["evento_id"]),
        nome=r["nome"],
        descricao=r["descricao"],
    )

def map_lote(r: Any) -> Lote:
    return Lote(
        id=str(r["id"]),
        setor_id=str(r["setor_id"]),
        nome=r["nome"],
        preco_centavos=r["preco_centavos"],
        desconto_percentual=r["desconto_percentual"],
        politica_padrao=r["politica_padrao"],
        capacidade_lote=r["capacidade"],
        reservados_lote=r["reservados"],
        inicio_vendas=r["inicio_vendas"],
        fim_vendas=r["fim_vendas"],
        ativo=r["ativo"],
    )

def map_reserva(r: Any) -> Reserva:
    raw_itens = r["itens"]
    itens = json.loads(raw_itens) if isinstance(raw_itens, str) else raw_itens
    return Reserva(
        pedido_id=str(r["pedido_id"]),
        evento_id=str(r["evento_id"]),
        itens=itens,
        total_centavos=r["total_centavos"],
        status=r["status"],
    )

# ---------- Eventos ----------

async def criar_evento(d: DadosEvento, organizador_id: str, conn: Optional[asyncpg.Connection] = None) -> Evento:
    novo_id = uuid.uuid4()
    sql = """
        INSERT INTO eventos (id, nome, descricao, data_hora, local, status, organizador_id)
        VALUES ($1, $2, $3, $4, $5, 'RASCUNHO', $6)
        RETURNING *
    """
    if conn:
        r = await conn.fetchrow(sql, novo_id, d.nome, d.descricao, d.data_hora, d.local, uuid.UUID(organizador_id))
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            r = await c.fetchrow(sql, novo_id, d.nome, d.descricao, d.data_hora, d.local, uuid.UUID(organizador_id))
    return map_evento(r)

async def buscar_evento(id: str, conn: Optional[asyncpg.Connection] = None, travar: bool = False) -> Optional[Evento]:
    lock = " FOR UPDATE" if travar else ""
    sql = f"SELECT * FROM eventos WHERE id = $1{lock}"
    uid = uuid.UUID(id)
    if conn:
        r = await conn.fetchrow(sql, uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            r = await c.fetchrow(sql, uid)
    return map_evento(r) if r else None

async def listar_eventos(
    ver_tudo: bool,
    organizador_id: Optional[str] = None,
    status: Optional[str] = None,
    busca: Optional[str] = None,
    so_do_organizador: Optional[str] = None,
    conn: Optional[asyncpg.Connection] = None
) -> list[Evento]:
    sql = """
        SELECT * FROM eventos
        WHERE ($1::boolean OR status <> 'RASCUNHO' OR organizador_id = $2::uuid)
          AND ($3::text IS NULL OR status = $3)
          AND ($4::text IS NULL OR nome ILIKE '%' || $4 || '%' OR local ILIKE '%' || $4 || '%')
          AND ($5::uuid IS NULL OR organizador_id = $5)
        ORDER BY data_hora ASC
    """
    org_uid = uuid.UUID(organizador_id) if organizador_id else None
    so_org_uid = uuid.UUID(so_do_organizador) if so_do_organizador else None

    if conn:
        rows = await conn.fetch(sql, ver_tudo, org_uid, status, busca, so_org_uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            rows = await c.fetch(sql, ver_tudo, org_uid, status, busca, so_org_uid)
    return [map_evento(r) for r in rows]

async def atualizar_evento(conn: asyncpg.Connection, id: str, d: dict) -> None:
    await conn.execute(
        """
        UPDATE eventos SET
            nome      = COALESCE($2, nome),
            descricao = COALESCE($3, descricao),
            data_hora = COALESCE($4, data_hora),
            local     = COALESCE($5, local)
        WHERE id = $1
        """,
        uuid.UUID(id),
        d.get("nome"),
        d.get("descricao"),
        d.get("data_hora"),
        d.get("local"),
    )

async def atualizar_status(
    conn: asyncpg.Connection, id: str, status: str, motivo: Optional[str] = None
) -> None:
    await conn.execute(
        """
        UPDATE eventos SET
            status = $2,
            motivo_cancelamento = COALESCE($3, motivo_cancelamento)
        WHERE id = $1
        """,
        uuid.UUID(id),
        status,
        motivo
    )

async def remover_evento(conn: asyncpg.Connection, id: str) -> bool:
    res = await conn.execute("DELETE FROM eventos WHERE id = $1", uuid.UUID(id))
    return res != "DELETE 0"

async def ativos_do_organizador(conn: asyncpg.Connection, organizador_id: str) -> list[Evento]:
    rows = await conn.fetch(
        """
        SELECT * FROM eventos
        WHERE organizador_id = $1 AND status NOT IN ('REALIZADO', 'CANCELADO')
        FOR UPDATE
        """,
        uuid.UUID(organizador_id)
    )
    return [map_evento(r) for r in rows]

# ---------- Setores ----------

async def criar_setor(
    conn: asyncpg.Connection, evento_id: str, nome: str, descricao: Optional[str] = None
) -> LinhaSetor:
    novo_id = uuid.uuid4()
    await conn.execute(
        "INSERT INTO setores (id, evento_id, nome, descricao) VALUES ($1, $2, $3, $4)",
        novo_id, uuid.UUID(evento_id), nome, descricao
    )
    return LinhaSetor(id=str(novo_id), evento_id=evento_id, nome=nome, descricao=descricao)

async def buscar_setor(conn: asyncpg.Connection, id: str) -> Optional[LinhaSetor]:
    r = await conn.fetchrow("SELECT * FROM setores WHERE id = $1", uuid.UUID(id))
    return map_setor(r) if r else None

async def atualizar_setor(
    conn: asyncpg.Connection, id: str, nome: Optional[str] = None, descricao: Optional[str] = None
) -> None:
    await conn.execute(
        """
        UPDATE setores SET
            nome = COALESCE($2, nome),
            descricao = COALESCE($3, descricao)
        WHERE id = $1
        """,
        uuid.UUID(id),
        nome,
        descricao
    )

async def remover_setor(conn: asyncpg.Connection, id: str) -> None:
    await conn.execute("DELETE FROM setores WHERE id = $1", uuid.UUID(id))

async def listar_setores(conn: asyncpg.Connection, evento_id: str) -> list[LinhaSetor]:
    rows = await conn.fetch(
        "SELECT * FROM setores WHERE evento_id = $1 ORDER BY criado_em",
        uuid.UUID(evento_id)
    )
    return [map_setor(r) for r in rows]

# ---------- Lotes ----------

async def criar_lote(conn: asyncpg.Connection, setor_id: str, d: DadosLote) -> Lote:
    novo_id = uuid.uuid4()
    r = await conn.fetchrow(
        """
        INSERT INTO lotes (id, setor_id, nome, preco_centavos, desconto_percentual, politica_padrao,
                           capacidade, inicio_vendas, fim_vendas, ativo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
        """,
        novo_id,
        uuid.UUID(setor_id),
        d.nome,
        d.preco_centavos,
        d.desconto_percentual,
        d.politica_padrao,
        d.capacidade,
        d.inicio_vendas,
        d.fim_vendas,
        d.ativo
    )
    return map_lote(r)

async def buscar_lote(conn: asyncpg.Connection, id: str, travar: bool = False) -> Optional[Lote]:
    lock = " FOR UPDATE" if travar else ""
    r = await conn.fetchrow(f"SELECT * FROM lotes WHERE id = $1{lock}", uuid.UUID(id))
    return map_lote(r) if r else None

async def atualizar_lote(conn: asyncpg.Connection, id: str, d: dict) -> None:
    await conn.execute(
        """
        UPDATE lotes SET
            nome                = COALESCE($2, nome),
            preco_centavos      = COALESCE($3, preco_centavos),
            desconto_percentual = COALESCE($4, desconto_percentual),
            politica_padrao     = COALESCE($5, politica_padrao),
            capacidade          = COALESCE($6, capacidade),
            inicio_vendas       = COALESCE($7, inicio_vendas),
            fim_vendas          = COALESCE($8, fim_vendas),
            ativo               = COALESCE($9, ativo)
        WHERE id = $1
        """,
        uuid.UUID(id),
        d.get("nome"),
        d.get("preco_centavos"),
        d.get("desconto_percentual"),
        d.get("politica_padrao"),
        d.get("capacidade"),
        d.get("inicio_vendas"),
        d.get("fim_vendas"),
        d.get("ativo"),
    )

async def remover_lote(conn: asyncpg.Connection, id: str) -> None:
    await conn.execute("DELETE FROM lotes WHERE id = $1", uuid.UUID(id))

async def listar_lotes_do_evento(conn: asyncpg.Connection, evento_id: str) -> list[Lote]:
    rows = await conn.fetch(
        """
        SELECT l.* FROM lotes l
        JOIN setores s ON s.id = l.setor_id
        WHERE s.evento_id = $1
        ORDER BY l.criado_em
        """,
        uuid.UUID(evento_id)
    )
    return [map_lote(r) for r in rows]

async def carregar_estrutura(conn: Optional[asyncpg.Connection], evento: Evento) -> EventoComposto:
    async def _carregar(c: asyncpg.Connection):
        setores = await listar_setores(c, evento.id)
        lotes = await listar_lotes_do_evento(c, evento.id)
        return EventoComposto.montar(evento, setores, lotes)

    if conn:
        return await _carregar(conn)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            return await _carregar(c)

async def setor_do_evento(conn: asyncpg.Connection, setor_id: str, evento_id: str) -> Optional[LinhaSetor]:
    s = await buscar_setor(conn, setor_id)
    return s if (s and s.evento_id == evento_id) else None

async def evento_do_lote(conn: asyncpg.Connection, lote_id: str) -> Optional[str]:
    r = await conn.fetchrow(
        "SELECT s.evento_id FROM lotes l JOIN setores s ON s.id = l.setor_id WHERE l.id = $1",
        uuid.UUID(lote_id)
    )
    return str(r["evento_id"]) if r else None

# ---------- Reserva e liberação de lugares ----------

async def reservar_lugares(conn: asyncpg.Connection, lote_id: str, quantidade: int) -> bool:
    res = await conn.execute(
        """
        UPDATE lotes SET reservados = reservados + $2
        WHERE id = $1 AND reservados + $2 <= capacidade
        """,
        uuid.UUID(lote_id),
        quantidade
    )
    return res != "UPDATE 0"

async def liberar_lugares(conn: asyncpg.Connection, lote_id: str, quantidade: int) -> None:
    await conn.execute(
        """
        UPDATE lotes SET reservados = GREATEST(0, reservados - $2) WHERE id = $1
        """,
        uuid.UUID(lote_id),
        quantidade
    )

# ---------- Reservas por pedido ----------

async def buscar_reserva(conn: asyncpg.Connection, pedido_id: str, travar: bool = False) -> Optional[Reserva]:
    lock = " FOR UPDATE" if travar else ""
    r = await conn.fetchrow(f"SELECT * FROM reservas WHERE pedido_id = $1{lock}", uuid.UUID(pedido_id))
    return map_reserva(r) if r else None

async def criar_reserva(
    conn: asyncpg.Connection,
    pedido_id: str,
    evento_id: str,
    itens: list[dict],
    total_centavos: int
) -> None:
    await conn.execute(
        """
        INSERT INTO reservas (pedido_id, evento_id, itens, total_centavos, status)
        VALUES ($1, $2, $3, $4, 'ATIVA')
        """,
        uuid.UUID(pedido_id),
        uuid.UUID(evento_id),
        json.dumps(itens),
        total_centavos
    )

async def marcar_reserva_liberada(conn: asyncpg.Connection, pedido_id: str) -> None:
    await conn.execute(
        "UPDATE reservas SET status = 'LIBERADA', liberado_em = now() WHERE pedido_id = $1",
        uuid.UUID(pedido_id)
    )

async def reservas_ativas_do_evento(conn: asyncpg.Connection, evento_id: str) -> list[Reserva]:
    rows = await conn.fetch(
        "SELECT * FROM reservas WHERE evento_id = $1 AND status = 'ATIVA' FOR UPDATE",
        uuid.UUID(evento_id)
    )
    return [map_reserva(r) for r in rows]

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
