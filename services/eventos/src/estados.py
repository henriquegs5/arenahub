from abc import ABC
from typing import Literal

"""
Padrão GoF: STATE.

O ciclo de vida do evento é modelado por um objeto de estado por situação.
Cada estado decide quais transições aceita e o que permite fazer; as demais
lançam TransicaoInvalida. Nenhum `if (status == ...)` espalhado pelo serviço.

  RASCUNHO ──▶ PUBLICADO ──▶ VENDAS_ABERTAS ──▶ VENDAS_ENCERRADAS ──▶ REALIZADO
      │            │               │                    │
      └────────────┴───────────────┴────────────────────┴──▶ CANCELADO

RASCUNHO           só o organizador vê; a estrutura está sendo montada.
PUBLICADO          visível no catálogo, mas ainda sem vender.
VENDAS_ABERTAS     única situação em que se reserva lugar.
VENDAS_ENCERRADAS  nada mais é vendido; os ingressos emitidos valem na entrada.
REALIZADO          o evento aconteceu; nada mais muda.
CANCELADO          dispara invalidação dos ingressos e estorno.
"""

StatusEvento = Literal[
    "RASCUNHO",
    "PUBLICADO",
    "VENDAS_ABERTAS",
    "VENDAS_ENCERRADAS",
    "REALIZADO",
    "CANCELADO",
]

STATUS_EVENTO: list[StatusEvento] = [
    "RASCUNHO",
    "PUBLICADO",
    "VENDAS_ABERTAS",
    "VENDAS_ENCERRADAS",
    "REALIZADO",
    "CANCELADO",
]

class TransicaoInvalida(Exception):
    def __init__(self, de: StatusEvento, acao: str):
        super().__init__(f"não é possível {acao} um evento em {de}")
        self.de = de
        self.acao = acao

class EstadoEvento(ABC):
    @property
    def nome(self) -> StatusEvento:
        raise NotImplementedError

    def aceita_vendas(self) -> bool:
        """Só se reserva lugar com as vendas abertas."""
        return False

    def visivel_no_catalogo(self) -> bool:
        """O evento aparece no catálogo para quem não é o organizador."""
        return True

    def aceita_edicao_estrutura(self) -> bool:
        """Setores e lotes podem ser criados, editados ou excluídos."""
        return False

    def aceita_edicao_dados(self) -> bool:
        """Nome, descrição, data e local podem ser alterados."""
        return False

    def permite_exclusao(self) -> bool:
        """Um evento encerrado ou já realizado não é apagado, para preservar o histórico."""
        return False

    def publicar(self) -> "EstadoEvento":
        raise TransicaoInvalida(self.nome, "publicar")

    def abrir_vendas(self) -> "EstadoEvento":
        raise TransicaoInvalida(self.nome, "abrir as vendas de")

    def encerrar_vendas(self) -> "EstadoEvento":
        raise TransicaoInvalida(self.nome, "encerrar as vendas de")

    def realizar(self) -> "EstadoEvento":
        raise TransicaoInvalida(self.nome, "marcar como realizado")

    def cancelar(self) -> "EstadoEvento":
        raise TransicaoInvalida(self.nome, "cancelar")

class Rascunho(EstadoEvento):
    @property
    def nome(self) -> StatusEvento:
        return "RASCUNHO"

    def visivel_no_catalogo(self) -> bool:
        return False

    def aceita_edicao_estrutura(self) -> bool:
        return True

    def aceita_edicao_dados(self) -> bool:
        return True

    def permite_exclusao(self) -> bool:
        return True

    def publicar(self) -> EstadoEvento:
        return Publicado()

    def cancelar(self) -> EstadoEvento:
        return Cancelado()

class Publicado(EstadoEvento):
    @property
    def nome(self) -> StatusEvento:
        return "PUBLICADO"

    def aceita_edicao_estrutura(self) -> bool:
        return True

    def aceita_edicao_dados(self) -> bool:
        return True

    def permite_exclusao(self) -> bool:
        return True

    def abrir_vendas(self) -> EstadoEvento:
        return VendasAbertas()

    def cancelar(self) -> EstadoEvento:
        return Cancelado()

class VendasAbertas(EstadoEvento):
    @property
    def nome(self) -> StatusEvento:
        return "VENDAS_ABERTAS"

    def aceita_vendas(self) -> bool:
        return True

    def aceita_edicao_estrutura(self) -> bool:
        return True

    def aceita_edicao_dados(self) -> bool:
        return True

    def encerrar_vendas(self) -> EstadoEvento:
        return VendasEncerradas()

    def cancelar(self) -> EstadoEvento:
        return Cancelado()

class VendasEncerradas(EstadoEvento):
    @property
    def nome(self) -> StatusEvento:
        return "VENDAS_ENCERRADAS"

    def aceita_edicao_dados(self) -> bool:
        return True

    def realizar(self) -> EstadoEvento:
        return Realizado()

    def cancelar(self) -> EstadoEvento:
        return Cancelado()

class Realizado(EstadoEvento):
    @property
    def nome(self) -> StatusEvento:
        return "REALIZADO"

class Cancelado(EstadoEvento):
    @property
    def nome(self) -> StatusEvento:
        return "CANCELADO"

def estado_de(status: StatusEvento) -> EstadoEvento:
    match status:
        case "RASCUNHO":
            return Rascunho()
        case "PUBLICADO":
            return Publicado()
        case "VENDAS_ABERTAS":
            return VendasAbertas()
        case "VENDAS_ENCERRADAS":
            return VendasEncerradas()
        case "REALIZADO":
            return Realizado()
        case "CANCELADO":
            return Cancelado()
        case _:
            raise ValueError(f"Status desconhecido: {status}")
