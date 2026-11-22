from abc import ABC, abstractmethod
from typing import Literal, Optional

"""
Padrões GoF: STRATEGY (Comportamental) + FACTORY METHOD (Criacional).
- Strategy: Define uma família de algoritmos intercambiáveis de avaliação de pagamento.
  Evita switch-case gigante e encapsula as regras de cada meio (Pix, Cartão, Boleto).
- Factory Method: Define a interface de criação da estratégia, delegando a instanciação
  às subclasses concretas de CriadorMeioPagamento.
"""

MeioPagamento = Literal["PIX", "CARTAO_CREDITO", "BOLETO", "CARTAO_RECUSADO"]
MEIOS_PAGAMENTO = ["PIX", "CARTAO_CREDITO", "BOLETO", "CARTAO_RECUSADO"]
CENTAVOS_RECUSA = 66

def em_reais(centavos: int) -> str:
    val = centavos / 100.0
    return f"R$\xa0{val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

def termina_em_centavos_de_recusa(valor_centavos: int) -> bool:
    return valor_centavos > 0 and (valor_centavos % 100) == CENTAVOS_RECUSA

class EstrategiaMeioPagamento(ABC):
    @property
    @abstractmethod
    def nome(self) -> MeioPagamento:
        pass

    @property
    @abstractmethod
    def rotulo(self) -> str:
        pass

    @property
    def limite_centavos(self) -> int:
        return 5_000_000  # R$ 50.000,00

    def aceita_estorno(self) -> bool:
        return True

    def avaliar(self, valor_centavos: int) -> Optional[str]:
        if valor_centavos < 0:
            return "valor inválido"
        if valor_centavos > self.limite_centavos:
            return f"valor acima do limite de {self.rotulo} para esta transação"
        if termina_em_centavos_de_recusa(valor_centavos):
            return f"pagamento não autorizado pelo emissor (valor terminado em {CENTAVOS_RECUSA} centavos)"
        return None

class Pix(EstrategiaMeioPagamento):
    @property
    def nome(self) -> MeioPagamento:
        return "PIX"

    @property
    def rotulo(self) -> str:
        return "Pix"

    @property
    def limite_centavos(self) -> int:
        return 2_000_000  # R$ 20.000,00

class CartaoCredito(EstrategiaMeioPagamento):
    @property
    def nome(self) -> MeioPagamento:
        return "CARTAO_CREDITO"

    @property
    def rotulo(self) -> str:
        return "Cartão de crédito"

class Boleto(EstrategiaMeioPagamento):
    @property
    def nome(self) -> MeioPagamento:
        return "BOLETO"

    @property
    def rotulo(self) -> str:
        return "Boleto"

    def aceita_estorno(self) -> bool:
        return False  # Boleto não aceita estorno automático

class CartaoRecusado(EstrategiaMeioPagamento):
    @property
    def nome(self) -> MeioPagamento:
        return "CARTAO_RECUSADO"

    @property
    def rotulo(self) -> str:
        return "Cartão de teste (recusa sempre)"

    def avaliar(self, valor_centavos: int) -> Optional[str]:
        return "cartão recusado pelo emissor (meio de teste, recusa sempre)"

# ---------- FACTORY METHOD ----------

class CriadorMeioPagamento(ABC):
    @abstractmethod
    def criar_estrategia(self) -> EstrategiaMeioPagamento:
        pass

class CriadorPix(CriadorMeioPagamento):
    def criar_estrategia(self) -> EstrategiaMeioPagamento:
        return Pix()

class CriadorCartaoCredito(CriadorMeioPagamento):
    def criar_estrategia(self) -> EstrategiaMeioPagamento:
        return CartaoCredito()

class CriadorBoleto(CriadorMeioPagamento):
    def criar_estrategia(self) -> EstrategiaMeioPagamento:
        return Boleto()

class CriadorCartaoRecusado(CriadorMeioPagamento):
    def criar_estrategia(self) -> EstrategiaMeioPagamento:
        return CartaoRecusado()

FABRICAS: dict[str, CriadorMeioPagamento] = {
    "PIX": CriadorPix(),
    "CARTAO_CREDITO": CriadorCartaoCredito(),
    "BOLETO": CriadorBoleto(),
    "CARTAO_RECUSADO": CriadorCartaoRecusado(),
}

def estrategia_para(meio: str) -> EstrategiaMeioPagamento:
    criador = FABRICAS.get(meio)
    if not criador:
        raise ValueError(f"Meio de pagamento desconhecido: {meio}")
    return criador.criar_estrategia()

def meio_valido(meio: str) -> bool:
    return meio in FABRICAS
