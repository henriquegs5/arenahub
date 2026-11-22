import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
import bcrypt
import jwt
from fastapi import APIRouter, Request, HTTPException, status, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..config import JWT_SECRET, JWT_EXPIRES_IN_HOURS
from ..messaging import contar_dlq, descartar_dlq, listar_dlq, reprocessar_dlq
from ..outbox import EventoSaida, transacao, transacao_com
from . import usuarios
from .usuarios import Papel, PAPEIS, PAPEIS_PUBLICOS

router = APIRouter()

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

def publico(u: usuarios.Usuario) -> dict:
    return {"id": u.id, "nome": u.nome, "email": u.email, "papel": u.papel}

class Autor(BaseModel):
    id: str
    papel: Papel

def quem(request: Request) -> Optional[Autor]:
    user_id = request.headers.get("x-user-id")
    role = request.headers.get("x-user-role")
    if user_id and role:
        if UUID_RE.match(user_id) and role in PAPEIS:
            return Autor(id=user_id, papel=role)  # type: ignore

    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            sub = str(payload.get("sub", ""))
            papel = str(payload.get("papel", ""))
            if UUID_RE.match(sub) and papel in PAPEIS:
                return Autor(id=sub, papel=papel)  # type: ignore
        except Exception:
            return None
    return None


def exigir(request: Request) -> Autor:
    autor = quem(request)
    if not autor:
        raise HTTPException(status_code=401, detail={"erro": "não autenticado"})
    return autor

def exigir_adm(request: Request) -> Autor:
    autor = exigir(request)
    if autor.papel != "ADM":
        raise HTTPException(status_code=403, detail={"erro": "ação restrita ao administrador"})
    return autor

def dono_ou_adm(a: Optional[Autor], dono_id: str) -> bool:
    return bool(a and (a.id == dono_id or a.papel == "ADM"))

# ---------- Cadastro e Login (rotas públicas) ----------

@router.post("/register", status_code=201)
async def register(request: Request):
    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    nome = corpo.get("nome")
    email = corpo.get("email")
    senha = corpo.get("senha")
    papel = corpo.get("papel")

    if not isinstance(nome, str) or len(nome.strip()) < 2:
        raise HTTPException(status_code=400, detail={"erro": "nome inválido"})
    if not isinstance(email, str) or not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail={"erro": "email inválido"})
    if not isinstance(senha, str) or len(senha) < 6:
        raise HTTPException(status_code=400, detail={"erro": "senha deve ter ao menos 6 caracteres"})
    if papel not in PAPEIS_PUBLICOS:
        raise HTTPException(status_code=400, detail={"erro": "papel deve ser PARTICIPANTE ou ORGANIZADOR"})

    email_norm = email.strip().lower()
    if await usuarios.por_email(email_norm):
        raise HTTPException(status_code=409, detail={"erro": "email já cadastrado"})

    senha_hash = bcrypt.hashpw(senha.encode(), bcrypt.gensalt()).decode()
    corr_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))

    async def _op(c):
        u = await usuarios.criar(c, nome.strip(), email_norm, papel, senha_hash)
        eventos = [
            EventoSaida(
                nome="usuario.registrado",
                correlation_id=corr_id,
                payload={
                    "usuarioId": u.id,
                    "nome": u.nome,
                    "email": u.email,
                    "papel": u.papel,
                    "destinatarios": [u.id],
                }
            )
        ]
        return u, eventos

    criado = await transacao_com(_op)
    return publico(criado)

@router.post("/login")
async def login(request: Request):
    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    email = corpo.get("email")
    senha = corpo.get("senha")

    if not isinstance(email, str) or not isinstance(senha, str):
        raise HTTPException(status_code=400, detail={"erro": "email e senha são obrigatórios"})

    u = await usuarios.por_email(email.strip().lower())
    if not u or not bcrypt.checkpw(senha.encode(), u.senha_hash.encode()):
        raise HTTPException(status_code=401, detail={"erro": "credenciais inválidas"})

    expira = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRES_IN_HOURS)
    payload = {
        "sub": u.id,
        "papel": u.papel,
        "nome": u.nome,
        "exp": expira
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")
    return {"token": token, "usuario": publico(u)}

# ---------- Conta do Usuário ----------

@router.get("/me")
async def get_me(request: Request):
    a = exigir(request)
    u = await usuarios.por_id(a.id)
    if not u:
        raise HTTPException(status_code=404, detail={"erro": "usuário não encontrado"})
    return publico(u)

@router.get("/usuarios")
async def listar_usuarios_endpoint(
    request: Request,
    ids: Optional[str] = Query(None)
):
    a = exigir(request)
    if a.papel == "ADM":
        return await usuarios.listar_completo()

    filtro = [x for x in ids.split(",") if UUID_RE.match(x)] if ids else None
    return await usuarios.listar_nomes(filtro)

@router.get("/usuarios/{id}")
async def obter_usuario_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    u = await usuarios.por_id(id)
    if not u:
        raise HTTPException(status_code=404, detail={"erro": "usuário não encontrado"})
    return publico(u) if dono_ou_adm(a, u.id) else {"id": u.id, "nome": u.nome}

async def editar_usuario(request: Request, alvo_id: str):
    a = exigir(request)
    if not dono_ou_adm(a, alvo_id):
        raise HTTPException(status_code=403, detail={"erro": "você só pode editar a sua própria conta"})

    try:
        corpo = await request.json()
    except Exception:
        corpo = {}

    nome = corpo.get("nome")
    senha = corpo.get("senha")
    senha_atual = corpo.get("senhaAtual")
    papel = corpo.get("papel")

    campos = {}

    if nome is not None:
        if not isinstance(nome, str) or len(nome.strip()) < 2:
            raise HTTPException(status_code=400, detail={"erro": "nome inválido"})
        campos["nome"] = nome.strip()

    alvo = await usuarios.por_id(alvo_id)
    if not alvo:
        raise HTTPException(status_code=404, detail={"erro": "usuário não encontrado"})

    if senha is not None:
        if not isinstance(senha, str) or len(senha) < 6:
            raise HTTPException(status_code=400, detail={"erro": "senha deve ter ao menos 6 caracteres"})
        if a.papel != "ADM":
            if not isinstance(senha_atual, str) or not bcrypt.checkpw(senha_atual.encode(), alvo.senha_hash.encode()):
                raise HTTPException(status_code=403, detail={"erro": "senha atual incorreta"})
        campos["senha_hash"] = bcrypt.hashpw(senha.encode(), bcrypt.gensalt()).decode()

    if papel is not None:
        if a.papel != "ADM":
            raise HTTPException(status_code=403, detail={"erro": "somente o administrador altera papéis"})
        if papel not in PAPEIS:
            raise HTTPException(status_code=400, detail={"erro": "papel inválido"})
        if alvo.papel == "ADM" and papel != "ADM" and (await usuarios.contar_adms()) <= 1:
            raise HTTPException(status_code=409, detail={"erro": "não é possível rebaixar o último administrador"})
        campos["papel"] = papel

    if not campos:
        raise HTTPException(status_code=400, detail={"erro": "nada para alterar"})

    corr_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))

    async def _op(c):
        await usuarios.atualizar(c, alvo_id, campos)
        return [
            EventoSaida(
                nome="usuario.atualizado",
                correlation_id=corr_id,
                payload={
                    "usuarioId": alvo_id,
                    "nome": campos.get("nome", alvo.nome),
                    "papel": campos.get("papel", alvo.papel),
                    "destinatarios": [alvo_id],
                }
            )
        ]

    await transacao(_op)
    atualizado = await usuarios.por_id(alvo_id)
    return publico(atualizado)

@router.patch("/me")
async def patch_me(request: Request):
    a = exigir(request)
    return await editar_usuario(request, a.id)

@router.patch("/usuarios/{id}")
async def patch_usuario(id: str, request: Request):
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    return await editar_usuario(request, id)

@router.delete("/usuarios/{id}")
async def excluir_usuario_endpoint(id: str, request: Request):
    a = exigir(request)
    if not UUID_RE.match(id):
        raise HTTPException(status_code=400, detail={"erro": "id inválido"})
    if not dono_ou_adm(a, id):
        raise HTTPException(status_code=403, detail={"erro": "você só pode excluir a sua própria conta"})

    alvo = await usuarios.por_id(id)
    if not alvo:
        raise HTTPException(status_code=404, detail={"erro": "usuário não encontrado"})
    if alvo.papel == "ADM" and (await usuarios.contar_adms()) <= 1:
        raise HTTPException(status_code=409, detail={"erro": "não é possível excluir o último administrador"})

    corr_id = getattr(request.state, "correlation_id", str(uuid.uuid4()))

    async def _op(c):
        await usuarios.remover(c, alvo.id)
        return [
            EventoSaida(
                nome="usuario.removido",
                correlation_id=corr_id,
                payload={
                    "usuarioId": alvo.id,
                    "nome": alvo.nome,
                    "papel": alvo.papel,
                    "removidoPor": a.id,
                    "destinatarios": [],
                }
            )
        ]

    await transacao(_op)
    return {"removido": alvo.id}

# ---------- Dead Letter do Gateway (ADM) ----------

@router.get("/dlq")
async def get_dlq(request: Request):
    exigir_adm(request)
    return {"total": await contar_dlq(), "mensagens": await listar_dlq(50)}

@router.post("/dlq/reprocessar")
async def post_reprocessar_dlq(request: Request):
    exigir_adm(request)
    return {"reprocessadas": await reprocessar_dlq(50)}

@router.delete("/dlq")
async def delete_dlq(request: Request):
    exigir_adm(request)
    return {"descartadas": await descartar_dlq()}
