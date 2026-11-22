import random
import string
import time
import uuid
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel
from .meios import EstrategiaMeioPagamento, MeioPagamento, estrategia_para, em_reais

"""
Padrão GoF: ADAPTER (Estrutural).
Adapta um provedor externo fictício à interface interna esperada por ProvedorPagamento.
Garante que dados sensíveis não sejam logados nem trafeguem expostos (mascaramento).
"""

def mascarar_referencia(referencia: str) -> str:
    if not referencia:
        return "—"
    ref = referencia.strip()
    if len(ref) <= 4:
        return "****"
    return f"****{ref[-4:]}"

def gerar_autorizacao() -> str:
    part1 = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    part2 = hex(int(time.time() * 1000))[-4:].upper()
    return f"{part1}{part2}"

# --- Estruturas da interface interna (Target) ---

class PedidoCobranca(BaseModel):
    pedidoId: str
    valorCentavos: int
    meio: MeioPagamento
    referenciaPagamento: str
    idempotencyKey: str

class RespostaCobranca(BaseModel):
    aprovado: bool
    identificadorExterno: str
    autorizacao: Optional[str] = None
    motivoRecusa: Optional[str] = None

class PedidoEstorno(BaseModel):
    identificadorExterno: str
    meio: MeioPagamento
    motivo: str

class RespostaEstorno(BaseModel):
    estornado: bool
    motivoRecusa: Optional[str] = None

class ProvedorPagamento(ABC):
    @abstractmethod
    def cobrar(self, pedido: PedidoCobranca) -> RespostaCobranca:
        pass

    @abstractmethod
    def estornar(self, pedido: PedidoEstorno) -> RespostaEstorno:
        pass

# --- SDK de Terceiros (Adaptee) ---

class ClientePagamentoExterno:
    def charge(self, amount_cents: int, method: str, payment_token: str, idempotency_key: str, estrategia: EstrategiaMeioPagamento) -> dict:
        recusa = estrategia.avaliar(amount_cents)
        agora = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if recusa:
            print(f"[provedor simulado] CHARGE DECLINED amount={em_reais(amount_cents)} method={method} reason=\"{recusa}\"")
            return {
                "charge_id": str(uuid.uuid4()),
                "status": "declined",
                "decline_reason": recusa,
                "processed_at": agora,
            }
        print(f"[provedor simulado] CHARGE APPROVED amount={em_reais(amount_cents)} method={method}")
        return {
            "charge_id": str(uuid.uuid4()),
            "status": "approved",
            "authorization_code": gerar_autorizacao(),
            "processed_at": agora,
        }

    def refund(self, charge_id: str, estrategia: EstrategiaMeioPagamento) -> dict:
        if not estrategia.aceita_estorno():
            print(f"[provedor simulado] REFUND REJECTED charge={charge_id} ({estrategia.rotulo} não estorna)")
            return {
                "refund_id": str(uuid.uuid4()),
                "status": "rejected",
                "reason": f"{estrategia.rotulo} não aceita estorno automático; o reembolso é tratado manualmente",
            }
        print(f"[provedor simulado] REFUND OK charge={charge_id}")
        return {
            "refund_id": str(uuid.uuid4()),
            "status": "refunded",
        }

# --- Adapter Concreto ---

class ProvedorSimuladoAdapter(ProvedorPagamento):
    def __init__(self, cliente: Optional[ClientePagamentoExterno] = None):
        self._cliente = cliente or ClientePagamentoExterno()

    def cobrar(self, pedido: PedidoCobranca) -> RespostaCobranca:
        estrategia = estrategia_para(pedido.meio)
        resp = self._cliente.charge(
            amount_cents=pedido.valorCentavos,
            method=pedido.meio,
            payment_token=pedido.referenciaPagamento,
            idempotency_key=pedido.idempotencyKey,
            estrategia=estrategia
        )
        if resp["status"] == "approved":
            return RespostaCobranca(
                aprovado=True,
                identificadorExterno=resp["charge_id"],
                autorizacao=resp.get("authorization_code")
            )
        return RespostaCobranca(
            aprovado=False,
            identificadorExterno=resp["charge_id"],
            motivoRecusa=resp.get("decline_reason")
        )

    def estornar(self, pedido: PedidoEstorno) -> RespostaEstorno:
        estrategia = estrategia_para(pedido.meio)
        resp = self._cliente.refund(
            charge_id=pedido.identificadorExterno,
            estrategia=estrategia
        )
        if resp["status"] == "refunded":
            return RespostaEstorno(estornado=True)
        return RespostaEstorno(
            estornado=False,
            motivoRecusa=resp.get("reason")
        )
