from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from .precos import PoliticaPreco, estrategia_para

"""
Padrão GoF: COMPOSITE.

  EventoComposto (raiz)  →  Setor (composto)  →  Lote (folha)

Os três implementam ComponenteEvento, então "qual a capacidade?",
"quantos lugares já saíram?" e "quantos ainda há?" são respondidos do mesmo
jeito para o evento inteiro, para um setor ou para um único lote. A
capacidade do evento é literalmente a soma das partes — não existe um campo
`capacidade_total` que possa divergir da estrutura.

A capacidade real mora nas FOLHAS (os lotes). Um setor sem lote tem
capacidade zero, e por isso o evento só pode ser publicado quando a estrutura
tem lugares de verdade.
"""

class ComponenteEvento(ABC):
    @property
    @abstractmethod
    def nome(self) -> str:
        pass

    @abstractmethod
    def capacidade(self) -> int:
        pass

    @abstractmethod
    def reservados(self) -> int:
        pass

    @abstractmethod
    def disponiveis(self) -> int:
        pass

class Lote(ComponenteEvento):
    """FOLHA: um lote de ingressos, com preço, política e janela de vigência."""

    def __init__(
        self,
        id: str,
        setor_id: str,
        nome: str,
        preco_centavos: int,
        desconto_percentual: int,
        politica_padrao: PoliticaPreco,
        capacidade_lote: int,
        reservados_lote: int,
        inicio_vendas: Optional[datetime],
        fim_vendas: Optional[datetime],
        ativo: bool,
    ):
        self.id = id
        self.setor_id = setor_id
        self._nome = nome
        self.preco_centavos = preco_centavos
        self.desconto_percentual = desconto_percentual
        self.politica_padrao = politica_padrao
        self.capacidade_lote = capacidade_lote
        self.reservados_lote = reservados_lote
        self.inicio_vendas = inicio_vendas
        self.fim_vendas = fim_vendas
        self.ativo = ativo

    @property
    def nome(self) -> str:
        return self._nome

    def capacidade(self) -> int:
        return self.capacidade_lote

    def reservados(self) -> int:
        return self.reservados_lote

    def disponiveis(self) -> int:
        return max(0, self.capacidade_lote - self.reservados_lote)

    def vigente(self, agora: Optional[datetime] = None) -> bool:
        """O lote está valendo agora? Lote fora da janela não vende."""
        if not self.ativo:
            return False
        if agora is None:
            agora = datetime.now(timezone.utc)
        elif agora.tzinfo is None:
            agora = agora.replace(tzinfo=timezone.utc)

        if self.inicio_vendas:
            iv = self.inicio_vendas if self.inicio_vendas.tzinfo else self.inicio_vendas.replace(tzinfo=timezone.utc)
            if agora < iv:
                return False
        if self.fim_vendas:
            fv = self.fim_vendas if self.fim_vendas.tzinfo else self.fim_vendas.replace(tzinfo=timezone.utc)
            if agora > fv:
                return False
        return True

    def preco_unitario(self, politica: Optional[PoliticaPreco] = None) -> int:
        """Preço unitário em centavos para a política pedida (Strategy)."""
        pol = politica or self.politica_padrao
        return estrategia_para(pol).preco_unitario(self.preco_centavos, self.desconto_percentual)

class Setor(ComponenteEvento):
    """COMPOSTO: um setor do local (Pista, Arquibancada, Camarote), que agrupa lotes."""

    def __init__(
        self,
        id: str,
        evento_id: str,
        nome: str,
        descricao: Optional[str] = None
    ):
        self.id = id
        self.evento_id = evento_id
        self._nome = nome
        self.descricao = descricao
        self._lotes: list[Lote] = []

    @property
    def nome(self) -> str:
        return self._nome

    def adicionar(self, lote: Lote) -> "Setor":
        self._lotes.append(lote)
        return self

    def filhos(self) -> list[Lote]:
        return list(self._lotes)

    def capacidade(self) -> int:
        return sum(l.capacidade() for l in self._lotes)

    def reservados(self) -> int:
        return sum(l.reservados() for l in self._lotes)

    def disponiveis(self) -> int:
        return sum(l.disponiveis() for l in self._lotes)

    def lotes_vigentes(self, agora: Optional[datetime] = None) -> list[Lote]:
        return [l for l in self._lotes if l.vigente(agora) and l.disponiveis() > 0]

    def preco_minimo(self, agora: Optional[datetime] = None) -> Optional[int]:
        precos = [l.preco_unitario() for l in self.lotes_vigentes(agora)]
        return min(precos) if precos else None

class EventoComposto(ComponenteEvento):
    """COMPOSTO RAIZ: o evento, que agrupa setores."""

    def __init__(self, id: str, nome: str):
        self.id = id
        self._nome = nome
        self._setores: list[Setor] = []

    @property
    def nome(self) -> str:
        return self._nome

    def adicionar(self, setor: Setor) -> "EventoComposto":
        self._setores.append(setor)
        return self

    def filhos(self) -> list[Setor]:
        return list(self._setores)

    def capacidade(self) -> int:
        return sum(s.capacidade() for s in self._setores)

    def reservados(self) -> int:
        return sum(s.reservados() for s in self._setores)

    def disponiveis(self) -> int:
        return sum(s.disponiveis() for s in self._setores)

    def preco_minimo(self, agora: Optional[datetime] = None) -> Optional[int]:
        precos = [s.preco_minimo(agora) for s in self._setores]
        validos = [p for p in precos if p is not None]
        return min(validos) if validos else None

    def achar_lote(self, lote_id: str) -> Optional[Lote]:
        """Acha um lote em qualquer setor, sem o chamador percorrer a árvore."""
        for s in self._setores:
            for l in s.filhos():
                if l.id == lote_id:
                    return l
        return None

    @classmethod
    def montar(
        cls,
        evento: Any,
        setores: list[Any],
        lotes: list[Lote]
    ) -> "EventoComposto":
        """Monta a árvore a partir das linhas do banco."""
        raiz = cls(evento.id, evento.nome)
        for s in setores:
            setor = Setor(s.id, s.evento_id, s.nome, s.descricao)
            for l in [x for x in lotes if x.setor_id == s.id]:
                setor.adicionar(l)
            raiz.adicionar(setor)
        return raiz
