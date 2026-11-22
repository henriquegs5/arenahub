from abc import ABC
from typing import Literal

"""
Padrão GoF: STATE — duas máquinas de estado, uma para o PEDIDO e outra para o
INGRESSO. Cada estado decide o que aceita; o resto do serviço nunca testa
`if (status == ...)` para saber se uma ação é possível.

PEDIDO (dirigido pela Saga)

  PENDENTE ──▶ RESERVADO ──▶ AGUARDANDO_PAGAMENTO ──▶ PAGO ──▶ CONCLUIDO
      │            │                   │
      └────────────┴───────────────────┴──▶ CANCELADO | RECUSADO | EXPIRADO
"""

StatusPedido = Literal[
    "PENDENTE",
    "RESERVADO",
    "AGUARDANDO_PAGAMENTO",
    "PAGO",
    "CONCLUIDO",
    "RECUSADO",
    "EXPIRADO",
    "CANCELADO",
]

STATUS_PEDIDO: list[StatusPedido] = [
    "PENDENTE", "RESERVADO", "AGUARDANDO_PAGAMENTO", "PAGO",
    "CONCLUIDO", "RECUSADO", "EXPIRADO", "CANCELADO",
]

PEDIDO_FINALIZADO: list[StatusPedido] = ["CONCLUIDO", "RECUSADO", "EXPIRADO", "CANCELADO"]
PEDIDO_EM_ANDAMENTO: list[StatusPedido] = ["PENDENTE", "RESERVADO", "AGUARDANDO_PAGAMENTO", "PAGO"]

class TransicaoInvalida(Exception):
    def __init__(self, de: str, acao: str):
        super().__init__(f"não é possível {acao} um pedido em {de}")
        self.de = de
        self.acao = acao

class EstadoPedido(ABC):
    @property
    def nome(self) -> StatusPedido:
        raise NotImplementedError

    def tem_lugares_reservados(self) -> bool:
        """Já houve reserva de lugares? Decide se a compensação precisa liberá-los."""
        return False

    def aceita_cancelamento(self) -> bool:
        """O comprador ainda pode cancelar?"""
        return False

    def em_andamento(self) -> bool:
        """O pedido ainda está correndo, logo pode expirar."""
        return self.nome not in PEDIDO_FINALIZADO

    def exige_estorno(self) -> bool:
        """Houve cobrança aprovada que precisa de estorno ao cancelar?"""
        return False

    def reservar(self) -> "EstadoPedido":
        raise TransicaoInvalida(self.nome, "reservar lugares para")

    def cobrar(self) -> "EstadoPedido":
        raise TransicaoInvalida(self.nome, "cobrar")

    def aprovar(self) -> "EstadoPedido":
        raise TransicaoInvalida(self.nome, "aprovar o pagamento de")

    def concluir(self) -> "EstadoPedido":
        raise TransicaoInvalida(self.nome, "concluir")

    def recusar(self) -> "EstadoPedido":
        raise TransicaoInvalida(self.nome, "recusar")

    def expirar(self) -> "EstadoPedido":
        raise TransicaoInvalida(self.nome, "expirar")

    def cancelar(self) -> "EstadoPedido":
        raise TransicaoInvalida(self.nome, "cancelar")

class Pendente(EstadoPedido):
    @property
    def nome(self) -> StatusPedido:
        return "PENDENTE"

    def aceita_cancelamento(self) -> bool:
        return True

    def reservar(self) -> EstadoPedido:
        return Reservado()

    def recusar(self) -> EstadoPedido:
        return Recusado()

    def expirar(self) -> EstadoPedido:
        return Expirado()

    def cancelar(self) -> EstadoPedido:
        return Cancelado()

class Reservado(EstadoPedido):
    @property
    def nome(self) -> StatusPedido:
        return "RESERVADO"

    def tem_lugares_reservados(self) -> bool:
        return True

    def aceita_cancelamento(self) -> bool:
        return True

    def cobrar(self) -> EstadoPedido:
        return AguardandoPagamento()

    def recusar(self) -> EstadoPedido:
        return Recusado()

    def expirar(self) -> EstadoPedido:
        return Expirado()

    def cancelar(self) -> EstadoPedido:
        return Cancelado()

class AguardandoPagamento(EstadoPedido):
    @property
    def nome(self) -> StatusPedido:
        return "AGUARDANDO_PAGAMENTO"

    def tem_lugares_reservados(self) -> bool:
        return True

    def aceita_cancelamento(self) -> bool:
        return True

    def aprovar(self) -> EstadoPedido:
        return Pago()

    def recusar(self) -> EstadoPedido:
        return Recusado()

    def expirar(self) -> EstadoPedido:
        return Expirado()

    def cancelar(self) -> EstadoPedido:
        return Cancelado()

class Pago(EstadoPedido):
    @property
    def nome(self) -> StatusPedido:
        return "PAGO"

    def tem_lugares_reservados(self) -> bool:
        return True

    def exige_estorno(self) -> bool:
        return True

    def concluir(self) -> EstadoPedido:
        return Concluido()

    def cancelar(self) -> EstadoPedido:
        return Cancelado()

    def expirar(self) -> EstadoPedido:
        raise TransicaoInvalida(self.nome, "expirar")

class Concluido(EstadoPedido):
    @property
    def nome(self) -> StatusPedido:
        return "CONCLUIDO"

    def tem_lugares_reservados(self) -> bool:
        return True

    def exige_estorno(self) -> bool:
        return True

    def aceita_cancelamento(self) -> bool:
        return True

    def cancelar(self) -> EstadoPedido:
        return Cancelado()

class Recusado(EstadoPedido):
    @property
    def nome(self) -> StatusPedido:
        return "RECUSADO"

class Expirado(EstadoPedido):
    @property
    def nome(self) -> StatusPedido:
        return "EXPIRADO"

class Cancelado(EstadoPedido):
    @property
    def nome(self) -> StatusPedido:
        return "CANCELADO"

def estado_pedido(status: StatusPedido) -> EstadoPedido:
    match status:
        case "PENDENTE": return Pendente()
        case "RESERVADO": return Reservado()
        case "AGUARDANDO_PAGAMENTO": return AguardandoPagamento()
        case "PAGO": return Pago()
        case "CONCLUIDO": return Concluido()
        case "RECUSADO": return Recusado()
        case "EXPIRADO": return Expirado()
        case "CANCELADO": return Cancelado()
        case _: raise ValueError(f"Status de pedido desconhecido: {status}")

# ================= Máquina de Estado do Ingresso =================

StatusIngresso = Literal["EMITIDO", "UTILIZADO", "CANCELADO", "INVALIDADO"]

class EstadoIngresso(ABC):
    @property
    def nome(self) -> StatusIngresso:
        raise NotImplementedError

    def valido(self) -> bool:
        """Vale para entrar?"""
        return False

    def motivo_recusa(self) -> str:
        return "ingresso inválido"

    def validar(self) -> "EstadoIngresso":
        raise Exception(self.motivo_recusa())

    def cancelar(self) -> "EstadoIngresso":
        raise Exception(f"não é possível cancelar um ingresso {self.nome}")

    def invalidar(self) -> "EstadoIngresso":
        raise Exception(f"não é possível invalidar um ingresso {self.nome}")

class Emitido(EstadoIngresso):
    @property
    def nome(self) -> StatusIngresso:
        return "EMITIDO"

    def valido(self) -> bool:
        return True

    def validar(self) -> EstadoIngresso:
        return Utilizado()

    def cancelar(self) -> EstadoIngresso:
        return IngressoCancelado()

    def invalidar(self) -> EstadoIngresso:
        return Invalidado()

class Utilizado(EstadoIngresso):
    @property
    def nome(self) -> StatusIngresso:
        return "UTILIZADO"

    def motivo_recusa(self) -> str:
        return "este ingresso já foi utilizado na entrada"

    def invalidar(self) -> EstadoIngresso:
        return Invalidado()

class IngressoCancelado(EstadoIngresso):
    @property
    def nome(self) -> StatusIngresso:
        return "CANCELADO"

    def motivo_recusa(self) -> str:
        return "este ingresso foi cancelado"

    def invalidar(self) -> EstadoIngresso:
        return Invalidado()

class Invalidado(EstadoIngresso):
    @property
    def nome(self) -> StatusIngresso:
        return "INVALIDADO"

    def motivo_recusa(self) -> str:
        return "este ingresso foi invalidado porque o evento foi cancelado"

def estado_ingresso(status: StatusIngresso) -> EstadoIngresso:
    match status:
        case "EMITIDO": return Emitido()
        case "UTILIZADO": return Utilizado()
        case "CANCELADO": return IngressoCancelado()
        case "INVALIDADO": return Invalidado()
        case _: raise ValueError(f"Status de ingresso desconhecido: {status}")
