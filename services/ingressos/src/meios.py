from typing import Literal

MEIOS_PAGAMENTO: list[str] = ["PIX", "CARTAO_CREDITO", "BOLETO", "CARTAO_RECUSADO"]

MeioPagamento = Literal["PIX", "CARTAO_CREDITO", "BOLETO", "CARTAO_RECUSADO"]

def meio_valido(m: object) -> bool:
    return isinstance(m, str) and m in MEIOS_PAGAMENTO

def em_reais(centavos: int) -> str:
    reais = centavos / 100
    formatado = f"{reais:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatado}"
