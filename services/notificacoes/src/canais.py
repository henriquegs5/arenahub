import json
import uuid
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from pydantic import BaseModel
from .db import get_pool

class Aviso(BaseModel):
    tipo: str
    titulo: str
    mensagem: str
    usuarioId: Optional[str] = None
    eventoId: Optional[str] = None
    pedidoId: Optional[str] = None
    ingressoId: Optional[str] = None
    dados: Dict[str, Any] = {}
    email: Optional[str] = None
    ocorridoEm: Optional[str] = None

"""
Padrão GoF: ADAPTER (Estrutural).
CanalNotificacao define a interface-alvo que o sistema espera.
CanalTela é o canal de persistência direta no banco de dados.
ClienteEmailExterno é um componente externo com interface incompatível.
CanalEmailAdapter compatibiliza ClienteEmailExterno à interface CanalNotificacao.
"""

class CanalNotificacao(ABC):
    @property
    @abstractmethod
    def nome(self) -> str:
        pass

    @abstractmethod
    def suporta(self, aviso: Aviso) -> bool:
        pass

    @abstractmethod
    async def enviar(self, aviso: Aviso) -> None:
        pass

class CanalTela(CanalNotificacao):
    @property
    def nome(self) -> str:
        return "tela"

    def suporta(self, aviso: Aviso) -> bool:
        return True

    async def enviar(self, a: Aviso) -> None:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO notificacoes (id, tipo, titulo, mensagem, usuario_id, evento_id, pedido_id, ingresso_id, dados, criado_em)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()))
                """,
                uuid.uuid4(),
                a.tipo,
                a.titulo,
                a.mensagem,
                uuid.UUID(a.usuarioId) if a.usuarioId else None,
                uuid.UUID(a.eventoId) if a.eventoId else None,
                uuid.UUID(a.pedidoId) if a.pedidoId else None,
                uuid.UUID(a.ingressoId) if a.ingressoId else None,
                json.dumps(a.dados),
                a.ocorridoEm
            )

class ClienteEmailExterno:
    """Adaptee: serviço externo de disparo de e-mails com assinatura própria."""
    def enviar_mensagem(self, destino: str, assunto: str, corpo_html: str) -> None:
        print(f"[email simulado] para={destino} assunto=\"{assunto}\" corpo={corpo_html}")

class CanalEmailAdapter(CanalNotificacao):
    """Adapter que converte a interface de ClienteEmailExterno para CanalNotificacao."""
    def __init__(self, cliente: Optional[ClienteEmailExterno] = None):
        self._cliente = cliente or ClienteEmailExterno()

    @property
    def nome(self) -> str:
        return "email"

    def suporta(self, a: Aviso) -> bool:
        return bool(a.email)

    async def enviar(self, a: Aviso) -> None:
        if not a.email:
            return
        corpo = f"<h2>{a.titulo}</h2><p>{a.mensagem}</p>"
        self._cliente.enviar_mensagem(a.email, a.titulo, corpo)

class Notificador:
    """Despachante de canais."""
    def __init__(self, canais: list[CanalNotificacao]):
        self._canais = canais

    async def notificar(self, aviso: Aviso) -> None:
        for c in self._canais:
            if c.suporta(aviso):
                await c.enviar(aviso)
