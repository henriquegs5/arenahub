from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel
from .estados import estado_de
from .estrutura import EventoComposto
from .precos import PoliticaPreco

"""
Padrão GoF: CHAIN OF RESPONSIBILITY.

As validações da compra que dependem de dados do EVENTO rodam aqui, no serviço
que é dono desses dados. Cada elo decide uma coisa só; quem recusa interrompe a
cadeia e devolve o motivo, que vira a mensagem de `reserva.recusada`.

A divisão das validações entre os dois serviços é proposital:

  Ingressos (validacoes.ts de lá)  papel do comprador, itens bem formados,
                                   limite por comprador, pedido duplicado.
  Eventos   (este arquivo)         evento publicado, vendas abertas, lote
                                   pertence ao evento, lote vigente, capacidade.

Cada serviço valida o que POSSUI.
"""

class ItemPedido(BaseModel):
    lote_id: str
    quantidade: int
    politica: PoliticaPreco = "INTEIRA"

class ContextoReserva:
    def __init__(self, evento: Any, arvore: EventoComposto, itens: list[ItemPedido], agora: datetime):
        self.evento = evento
        self.arvore = arvore
        self.itens = itens
        self.agora = agora

class ValidacaoReserva(ABC):
    """Elo da cadeia. `avaliar` devolve o motivo da recusa, ou None se aprovar."""

    def __init__(self):
        self._proximo: Optional[ValidacaoReserva] = None

    def encadear(self, proximo: "ValidacaoReserva") -> "ValidacaoReserva":
        """Encadeia e devolve o elo recebido, para montar a cadeia fluentemente."""
        self._proximo = proximo
        return proximo

    def verificar(self, ctx: ContextoReserva) -> Optional[str]:
        """Percorre a cadeia. Para no primeiro elo que recusar."""
        recusa = self.avaliar(ctx)
        if recusa:
            return recusa
        return self._proximo.verificar(ctx) if self._proximo else None

    @abstractmethod
    def avaliar(self, ctx: ContextoReserva) -> Optional[str]:
        pass

class VendasPrecisamEstarAbertas(ValidacaoReserva):
    """As vendas precisam estar abertas (decidido pelo State do evento)."""

    def avaliar(self, ctx: ContextoReserva) -> Optional[str]:
        if ctx.evento.status == "CANCELADO":
            return "este evento foi cancelado"
        if not estado_de(ctx.evento.status).aceita_vendas():
            return f"as vendas deste evento não estão abertas (situação: {ctx.evento.status})"
        return None

class ItensPrecisamSerValidos(ValidacaoReserva):
    """O pedido precisa ter itens bem formados, sem lote repetido."""

    def avaliar(self, ctx: ContextoReserva) -> Optional[str]:
        if not ctx.itens:
            return "o pedido não tem itens"
        if any(not isinstance(i.quantidade, int) or i.quantidade < 1 for i in ctx.itens):
            return "a quantidade de cada item precisa ser um inteiro maior que zero"
        ids = {i.lote_id for i in ctx.itens}
        if len(ids) != len(ctx.itens):
            return "o mesmo lote aparece mais de uma vez no pedido"
        return None

class LotesPrecisamSerDoEvento(ValidacaoReserva):
    """Cada lote precisa ser deste evento — não adianta pedir lote de outro."""

    def avaliar(self, ctx: ContextoReserva) -> Optional[str]:
        for item in ctx.itens:
            if not ctx.arvore.achar_lote(item.lote_id):
                return "um dos lotes não pertence a este evento"
        return None

class LotesPrecisamEstarVigentes(ValidacaoReserva):
    """O lote precisa estar vigente: ativo e dentro da janela de venda."""

    def avaliar(self, ctx: ContextoReserva) -> Optional[str]:
        for item in ctx.itens:
            lote = ctx.arvore.achar_lote(item.lote_id)
            if lote and not lote.vigente(ctx.agora):
                return f'o lote "{lote.nome}" não está disponível para venda agora'
        return None

class PrecisaHaverLugar(ValidacaoReserva):
    """
    Conferência prévia de capacidade, para recusar com uma mensagem boa.
    A garantia de verdade é o UPDATE atômico na hora de reservar: entre esta
    checagem e a reserva, outro comprador pode levar o último lugar.
    """

    def avaliar(self, ctx: ContextoReserva) -> Optional[str]:
        for item in ctx.itens:
            lote = ctx.arvore.achar_lote(item.lote_id)
            if lote and lote.disponiveis() < item.quantidade:
                return f'o lote "{lote.nome}" tem apenas {lote.disponiveis()} lugar(es) disponível(is)'
        return None

def cadeia_de_reserva() -> ValidacaoReserva:
    """Monta a cadeia na ordem em que faz sentido recusar."""
    primeiro = VendasPrecisamEstarAbertas()
    primeiro.encadear(ItensPrecisamSerValidos()) \
            .encadear(LotesPrecisamSerDoEvento()) \
            .encadear(LotesPrecisamEstarVigentes()) \
            .encadear(PrecisaHaverLugar())
    return primeiro
