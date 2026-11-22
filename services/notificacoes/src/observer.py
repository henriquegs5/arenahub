from abc import ABC, abstractmethod
from typing import Any, Dict

"""
Padrão GoF: OBSERVER (Comportamental).
Define uma dependência um-para-muitos entre objetos. O DespachanteEventos (Subject)
recebe cada evento do broker e notifica apenas os observadores inscritos para aquele tipo.
Novos comportamentos entram como novos Observadores sem alterar o consumidor de mensagens.
"""

class Observador(ABC):
    @abstractmethod
    def tipos(self) -> list[str]:
        """Tipos de eventos pelos quais este observador tem interesse."""
        pass

    @abstractmethod
    async def atualizar(self, evento: Dict[str, Any]) -> None:
        """Chamado pelo Subject quando um evento do tipo esperado ocorre."""
        pass

class DespachanteEventos:
    """O Subject concreto do padrão Observer."""
    def __init__(self):
        self._observadores: list[Observador] = []

    def assinar(self, observador: Observador) -> "DespachanteEventos":
        self._observadores.append(observador)
        return self

    async def notificar(self, evento: Dict[str, Any]) -> None:
        tipo = evento.get("type", "")
        for o in self._observadores:
            if tipo in o.tipos():
                await o.atualizar(evento)
