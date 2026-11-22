from abc import ABC, abstractmethod
from typing import Literal

"""
Padrões GoF: STRATEGY + FACTORY METHOD.

STRATEGY — cada política de preço do ingresso é uma estratégia plugável.
O serviço nunca pergunta "que política é esta?": ele pede o preço à estratégia.
Criar uma política nova (meia para professor, passaporte, etc.) é acrescentar
uma classe, sem tocar em quem calcula o total.

FACTORY METHOD — o criador declara `criar_estrategia()` e cada subclasse decide
qual estratégia instanciar; `criador_para()` escolhe o criador pela política.

DINHEIRO EM CENTAVOS (inteiro). Nunca em ponto flutuante: R$ 0,1 + R$ 0,2 não
dá R$ 0,3 em binário, e o erro apareceria no total do pedido.
"""

PoliticaPreco = Literal["INTEIRA", "MEIA", "PROMOCIONAL", "CORTESIA"]
POLITICAS_PRECO: list[PoliticaPreco] = ["INTEIRA", "MEIA", "PROMOCIONAL", "CORTESIA"]

class EstrategiaPreco(ABC):
    @property
    @abstractmethod
    def nome(self) -> PoliticaPreco:
        pass

    @property
    @abstractmethod
    def rotulo(self) -> str:
        pass

    @abstractmethod
    def preco_unitario(self, preco_base: int, desconto_percentual: int = 0) -> int:
        pass

class Inteira(EstrategiaPreco):
    @property
    def nome(self) -> PoliticaPreco:
        return "INTEIRA"

    @property
    def rotulo(self) -> str:
        return "Inteira"

    def preco_unitario(self, preco_base: int, desconto_percentual: int = 0) -> int:
        return max(0, round(preco_base))

class Meia(EstrategiaPreco):
    @property
    def nome(self) -> PoliticaPreco:
        return "MEIA"

    @property
    def rotulo(self) -> str:
        return "Meia-entrada"

    def preco_unitario(self, preco_base: int, desconto_percentual: int = 0) -> int:
        # 2501 / 2 = 1250.5 -> round to 1251 in standard business half-up
        # In Python, round(0.5) is even (banker's rounding), so let's do: int(x + 0.5)
        return max(0, int(preco_base / 2 + 0.5))

class Promocional(EstrategiaPreco):
    @property
    def nome(self) -> PoliticaPreco:
        return "PROMOCIONAL"

    @property
    def rotulo(self) -> str:
        return "Promocional do lote"

    def preco_unitario(self, preco_base: int, desconto_percentual: int = 0) -> int:
        desconto = min(max(desconto_percentual, 0), 100)
        return max(0, int((preco_base * (100 - desconto)) / 100 + 0.5))

class Cortesia(EstrategiaPreco):
    @property
    def nome(self) -> PoliticaPreco:
        return "CORTESIA"

    @property
    def rotulo(self) -> str:
        return "Cortesia"

    def preco_unitario(self, preco_base: int, desconto_percentual: int = 0) -> int:
        return 0

class CriadorPreco(ABC):
    @abstractmethod
    def criar_estrategia(self) -> EstrategiaPreco:
        pass

class CriadorInteira(CriadorPreco):
    def criar_estrategia(self) -> EstrategiaPreco:
        return Inteira()

class CriadorMeia(CriadorPreco):
    def criar_estrategia(self) -> EstrategiaPreco:
        return Meia()

class CriadorPromocional(CriadorPreco):
    def criar_estrategia(self) -> EstrategiaPreco:
        return Promocional()

class CriadorCortesia(CriadorPreco):
    def criar_estrategia(self) -> EstrategiaPreco:
        return Cortesia()

def criador_para(politica: PoliticaPreco) -> CriadorPreco:
    match politica:
        case "INTEIRA":
            return CriadorInteira()
        case "MEIA":
            return CriadorMeia()
        case "PROMOCIONAL":
            return CriadorPromocional()
        case "CORTESIA":
            return CriadorCortesia()
        case _:
            raise ValueError(f"Política desconhecida: {politica}")

def estrategia_para(politica: PoliticaPreco) -> EstrategiaPreco:
    return criador_para(politica).criar_estrategia()

def em_reais(centavos: int) -> str:
    reais = centavos / 100
    # Formata como moeda brasileira R$ 1.234,56
    formatado = f"{reais:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatado}"
