import re
from typing import Optional, Literal
from fastapi import Request, HTTPException, status
from pydantic import BaseModel

Papel = Literal["PARTICIPANTE", "ORGANIZADOR", "ADM"]
PAPEIS: list[Papel] = ["PARTICIPANTE", "ORGANIZADOR", "ADM"]

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

class Autor(BaseModel):
    id: str
    papel: Papel

def quem(request: Request) -> Optional[Autor]:
    user_id = request.headers.get("x-user-id")
    role = request.headers.get("x-user-role")
    if not user_id or not UUID_RE.match(user_id):
        return None
    if role not in PAPEIS:
        return None
    return Autor(id=user_id, papel=role)  # type: ignore

def exigir(request: Request) -> Autor:
    autor = quem(request)
    if not autor:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"erro": "não autenticado"})
    return autor

def exigir_adm(request: Request) -> Autor:
    autor = exigir(request)
    if autor.papel != "ADM":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"erro": "ação restrita ao administrador"})
    return autor

def exigir_papel(request: Request, *papeis: Papel) -> Autor:
    autor = exigir(request)
    if autor.papel != "ADM" and autor.papel not in papeis:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"erro": f"ação restrita a: {', '.join(papeis)}"}
        )
    return autor
