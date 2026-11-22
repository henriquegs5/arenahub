import re
from typing import Literal, Optional
from fastapi import Header, HTTPException, status
from pydantic import BaseModel

Papel = Literal["PARTICIPANTE", "ORGANIZADOR", "ADM"]
PAPEIS = ["PARTICIPANTE", "ORGANIZADOR", "ADM"]
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

class Autor(BaseModel):
    id: str
    papel: Papel

def quem(x_user_id: Optional[str] = Header(None, alias="x-user-id"),
         x_user_role: Optional[str] = Header(None, alias="x-user-role")) -> Optional[Autor]:
    if not x_user_id or not UUID_RE.match(x_user_id):
        return None
    if x_user_role not in PAPEIS:
        return None
    return Autor(id=x_user_id, papel=x_user_role) # type: ignore

def exigir(x_user_id: Optional[str] = Header(None, alias="x-user-id"),
           x_user_role: Optional[str] = Header(None, alias="x-user-role")) -> Autor:
    a = quem(x_user_id, x_user_role)
    if not a:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="não autenticado")
    return a

def exigir_adm(x_user_id: Optional[str] = Header(None, alias="x-user-id"),
               x_user_role: Optional[str] = Header(None, alias="x-user-role")) -> Autor:
    a = exigir(x_user_id, x_user_role)
    if a.papel != "ADM":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ação restrita ao administrador")
    return a
