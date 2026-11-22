import uuid
from typing import Any, Dict, List, Literal, Optional
import bcrypt
import asyncpg
from pydantic import BaseModel
from ..db import get_pool
from ..config import ADMIN_EMAIL, ADMIN_NOME, ADMIN_SENHA

Papel = Literal["PARTICIPANTE", "ORGANIZADOR", "ADM"]
PAPEIS: list[Papel] = ["PARTICIPANTE", "ORGANIZADOR", "ADM"]
PAPEIS_PUBLICOS: list[Papel] = ["PARTICIPANTE", "ORGANIZADOR"]

class Usuario(BaseModel):
    id: str
    nome: str
    email: str
    papel: Papel
    senha_hash: str

def map_usuario(r: Any) -> Usuario:
    return Usuario(
        id=str(r["id"]),
        nome=r["nome"],
        email=r["email"],
        papel=r["papel"],
        senha_hash=r["senha_hash"]
    )

async def migrate() -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS usuarios (
                id          UUID PRIMARY KEY,
                nome        TEXT NOT NULL,
                email       TEXT NOT NULL UNIQUE,
                papel       TEXT NOT NULL,
                senha_hash  TEXT NOT NULL,
                criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_check;
            UPDATE usuarios SET papel = 'PARTICIPANTE' WHERE papel = 'JOGADOR';
            ALTER TABLE usuarios ADD CONSTRAINT usuarios_papel_check
                CHECK (papel IN ('PARTICIPANTE','ORGANIZADOR','ADM'));
        """)

async def criar(
    conn: asyncpg.Connection,
    nome: str,
    email: str,
    papel: Papel,
    senha_hash: str
) -> Usuario:
    novo_id = uuid.uuid4()
    await conn.execute(
        "INSERT INTO usuarios (id, nome, email, papel, senha_hash) VALUES ($1,$2,$3,$4,$5)",
        novo_id, nome, email, papel, senha_hash
    )
    return Usuario(id=str(novo_id), nome=nome, email=email, papel=papel, senha_hash=senha_hash)

async def por_email(email: str, conn: Optional[asyncpg.Connection] = None) -> Optional[Usuario]:
    sql = "SELECT * FROM usuarios WHERE email = $1"
    if conn:
        r = await conn.fetchrow(sql, email)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            r = await c.fetchrow(sql, email)
    return map_usuario(r) if r else None

async def por_id(id: str, conn: Optional[asyncpg.Connection] = None, travar: bool = False) -> Optional[Usuario]:
    lock = " FOR UPDATE" if travar else ""
    sql = f"SELECT * FROM usuarios WHERE id = $1{lock}"
    uid = uuid.UUID(id)
    if conn:
        r = await conn.fetchrow(sql, uid)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            r = await c.fetchrow(sql, uid)
    return map_usuario(r) if r else None

async def atualizar(
    conn: asyncpg.Connection,
    id: str,
    campos: dict
) -> None:
    await conn.execute(
        """
        UPDATE usuarios
           SET nome       = COALESCE($2, nome),
               senha_hash = COALESCE($3, senha_hash),
               papel      = COALESCE($4, papel)
         WHERE id = $1
        """,
        uuid.UUID(id),
        campos.get("nome"),
        campos.get("senha_hash"),
        campos.get("papel"),
    )

async def remover(conn: asyncpg.Connection, id: str) -> bool:
    res = await conn.execute("DELETE FROM usuarios WHERE id = $1", uuid.UUID(id))
    return res != "DELETE 0"

async def contar_adms(conn: Optional[asyncpg.Connection] = None) -> int:
    sql = "SELECT count(*)::int AS n FROM usuarios WHERE papel = 'ADM'"
    if conn:
        val = await conn.fetchval(sql)
    else:
        pool = get_pool()
        async with pool.acquire() as c:
            val = await c.fetchval(sql)
    return val or 0

async def listar_nomes(ids: Optional[list[str]] = None) -> list[Dict[str, str]]:
    pool = get_pool()
    async with pool.acquire() as conn:
        if ids:
            uids = [uuid.UUID(x) for x in ids]
            rows = await conn.fetch("SELECT id, nome FROM usuarios WHERE id = ANY($1::uuid[]) ORDER BY nome", uids)
        else:
            rows = await conn.fetch("SELECT id, nome FROM usuarios ORDER BY nome")
        return [{"id": str(r["id"]), "nome": r["nome"]} for r in rows]

async def listar_completo() -> list[Dict[str, Any]]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, nome, email, papel, criado_em FROM usuarios ORDER BY nome")
        return [
            {
                "id": str(r["id"]),
                "nome": r["nome"],
                "email": r["email"],
                "papel": r["papel"],
                "criadoEm": r["criado_em"].isoformat(),
            }
            for r in rows
        ]

async def semear_admin() -> None:
    if not ADMIN_EMAIL or not ADMIN_SENHA:
        print("[gateway] ADMIN_EMAIL/ADMIN_SENHA não definidos; nenhum administrador inicial criado")
        return

    pool = get_pool()
    existente = await por_email(ADMIN_EMAIL)
    if existente:
        if existente.papel != "ADM":
            async with pool.acquire() as conn:
                await atualizar(conn, existente.id, {"papel": "ADM"})
            print(f"[gateway] conta {ADMIN_EMAIL} promovida a ADM")
        return

    senha_hash = bcrypt.hashpw(ADMIN_SENHA.encode(), bcrypt.gensalt()).decode()
    async with pool.acquire() as conn:
        u = await criar(conn, ADMIN_NOME, ADMIN_EMAIL, "ADM", senha_hash)
    print(f"[gateway] administrador inicial criado: {u.email}")
