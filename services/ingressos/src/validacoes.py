import re
from abc import ABC, abstractmethod
from typing import Optional, List
from pydantic import BaseModel
from .auth import Autor
from .config import LIMITE_POR_COMPRADOR
from .meios import meio_valido

"""
Padrão GoF: CHAIN OF RESPONSIBILITY — validações da compra.

Cada elo decide uma coisa só e, se recusar, interrompe a cadeia.
Esta cadeia valida o que o serviço de INGRESSOS possui:
- quem é o comprador
- itens bem formados
- meio de pagamento válido e sanitizado
- limite por comprador
- se já existe pedido rodando
"""

class ItemCompra(BaseModel):
    lote_id: str
    quantidade: int
    politica: str = "INTEIRA"

class ContextoCompra:
    def __init__(
        self,
        autor: Autor,
        evento_id: str,
        itens: list[ItemCompra],
        meio: str,
        referencia_pagamento: str,
        ja_pedidos: int,
        pedido_em_andamento: bool
    ):
        self.autor = autor
        self.evento_id = evento_id
        self.itens = itens
        self.meio = meio
        self.referencia_pagamento = referencia_pagamento
        self.ja_pedidos = ja_pedidos
        self.pedido_em_andamento = pedido_em_andamento

class Recusa:
    def __init__(self, status: int, mensagem: str):
        self.status = status
        self.mensagem = mensagem

class ValidacaoCompra(ABC):
    def __init__(self):
        self._proximo: Optional[ValidacaoCompra] = None

    def encadear(self, proximo: "ValidacaoCompra") -> "ValidacaoCompra":
        self._proximo = proximo
        return proximo

    def verificar(self, ctx: ContextoCompra) -> Optional[Recusa]:
        recusa = self.avaliar(ctx)
        if recusa:
            return recusa
        return self._proximo.verificar(ctx) if self._proximo else None

    @abstractmethod
    def avaliar(self, ctx: ContextoCompra) -> Optional[Recusa]:
        pass

class CompradorPrecisaPoderComprar(ValidacaoCompra):
    """Organizador não compra ingresso do próprio circuito; participante e ADM sim."""
    def avaliar(self, ctx: ContextoCompra) -> Optional[Recusa]:
        if ctx.autor.papel == "ORGANIZADOR":
            return Recusa(403, "contas de organizador não compram ingressos; use uma conta de participante")
        return None

class ItensPrecisamSerValidos(ValidacaoCompra):
    """Itens bem formados: pelo menos um, quantidade sadia, sem lote repetido."""
    MAX_ITENS = 10
    MAX_POR_ITEM = 20

    def avaliar(self, ctx: ContextoCompra) -> Optional[Recusa]:
        if len(ctx.itens) == 0:
            return Recusa(400, "escolha ao menos um lote")
        if len(ctx.itens) > self.MAX_ITENS:
            return Recusa(400, f"no máximo {self.MAX_ITENS} lotes por pedido")

        for i in ctx.itens:
            if not isinstance(i.quantidade, int) or i.quantidade < 1 or i.quantidade > self.MAX_POR_ITEM:
                return Recusa(400, f"a quantidade de cada lote deve ser de 1 a {self.MAX_POR_ITEM}")

        ids = {i.lote_id for i in ctx.itens}
        if len(ids) != len(ctx.itens):
            return Recusa(400, "o mesmo lote aparece mais de uma vez no pedido")

        return None

class PagamentoPrecisaSerInformado(ValidacaoCompra):
    """O meio de pagamento precisa existir e vir com uma referência opaca (token)."""
    def avaliar(self, ctx: ContextoCompra) -> Optional[Recusa]:
        if not meio_valido(ctx.meio):
            return Recusa(400, "escolha um meio de pagamento válido")
        if not ctx.referencia_pagamento or len(ctx.referencia_pagamento.strip()) < 4:
            return Recusa(400, "informe a referência do meio de pagamento")

        # Defesa explícita: token, nunca cartão
        limpo = re.sub(r"[\s-]", "", ctx.referencia_pagamento)
        if re.match(r"^\d{13,19}$", limpo):
            return Recusa(
                400,
                "não envie número de cartão: este sistema trabalha apenas com referência (token) do meio de pagamento"
            )
        return None

class NaoPodeHaverPedidoEmAndamento(ValidacaoCompra):
    """Um pedido por vez, por evento: evita clique duplo virar duas compras."""
    def avaliar(self, ctx: ContextoCompra) -> Optional[Recusa]:
        if ctx.pedido_em_andamento:
            return Recusa(409, "você já tem um pedido em andamento para este evento; conclua ou cancele antes")
        return None

class LimitePorComprador(ValidacaoCompra):
    """Limite de ingressos por comprador, por evento."""
    def avaliar(self, ctx: ContextoCompra) -> Optional[Recusa]:
        pedindo = sum(i.quantidade for i in ctx.itens)
        if ctx.ja_pedidos + pedindo > LIMITE_POR_COMPRADOR:
            ja = f" (você já tem {ctx.ja_pedidos})" if ctx.ja_pedidos > 0 else ""
            return Recusa(409, f"limite de {LIMITE_POR_COMPRADOR} ingressos por pessoa neste evento{ja}")
        return None

def cadeia_de_compra() -> ValidacaoCompra:
    primeiro = CompradorPrecisaPoderComprar()
    primeiro.encadear(ItensPrecisamSerValidos()) \
            .encadear(PagamentoPrecisaSerInformado()) \
            .encadear(NaoPodeHaverPedidoEmAndamento()) \
            .encadear(LimitePorComprador())
    return primeiro
