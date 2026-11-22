import time
from abc import ABC, abstractmethod
from typing import Callable, Literal, Optional

"""
CIRCUIT BREAKER (padrão arquitetural) implementado com o padrão GoF STATE.

 FECHADO ──(N falhas seguidas)──▶ ABERTO ──(passou o tempo)──▶ MEIO_ABERTO
    ▲                                ▲                              │
    └────────── sucesso ─────────────┼──────────────────────────────┤
                                     └──────────── falha ───────────┘

FECHADO: tudo passa. ABERTO: recusa na hora (não sobrecarrega serviço doente).
MEIO_ABERTO: deixa passar UMA requisição de teste.
"""

NomeEstado = Literal["FECHADO", "ABERTO", "MEIO_ABERTO"]

class EstadoCircuito(ABC):
    @property
    @abstractmethod
    def nome(self) -> NomeEstado:
        pass

    @abstractmethod
    def permitir(self, cb: "CircuitBreaker") -> bool:
        pass

    def sucesso(self, cb: "CircuitBreaker") -> None:
        pass

    def falha(self, cb: "CircuitBreaker") -> None:
        pass

class Fechado(EstadoCircuito):
    @property
    def nome(self) -> NomeEstado:
        return "FECHADO"

    def permitir(self, cb: "CircuitBreaker") -> bool:
        return True

    def sucesso(self, cb: "CircuitBreaker") -> None:
        cb.falhas_seguidas = 0

    def falha(self, cb: "CircuitBreaker") -> None:
        cb.falhas_seguidas += 1
        if cb.falhas_seguidas >= cb.limite_falhas:
            cb.transitar(Aberto(cb.agora()))

class Aberto(EstadoCircuito):
    def __init__(self, aberto_em: float):
        self.aberto_em = aberto_em

    @property
    def nome(self) -> NomeEstado:
        return "ABERTO"

    def permitir(self, cb: "CircuitBreaker") -> bool:
        if (cb.agora() - self.aberto_em) * 1000 < cb.tempo_aberto_ms:
            return False
        meio = MeioAberto()
        cb.transitar(meio)
        return meio.permitir(cb)

class MeioAberto(EstadoCircuito):
    def __init__(self):
        self.sonda_desde: Optional[float] = None

    @property
    def nome(self) -> NomeEstado:
        return "MEIO_ABERTO"

    def permitir(self, cb: "CircuitBreaker") -> bool:
        if self.sonda_desde is not None and (cb.agora() - self.sonda_desde) * 1000 < cb.tempo_aberto_ms:
            return False
        self.sonda_desde = cb.agora()
        return True

    def sucesso(self, cb: "CircuitBreaker") -> None:
        cb.transitar(Fechado())

    def falha(self, cb: "CircuitBreaker") -> None:
        cb.transitar(Aberto(cb.agora()))

class CircuitBreaker:
    def __init__(
        self,
        limite_falhas: int = 3,
        tempo_aberto_ms: int = 10000,
        agora: Optional[Callable[[], float]] = None,
        ao_mudar: Optional[Callable[[NomeEstado, NomeEstado], None]] = None,
    ):
        self.falhas_seguidas = 0
        self.limite_falhas = limite_falhas
        self.tempo_aberto_ms = tempo_aberto_ms
        self.agora = agora or time.time
        self.ao_mudar = ao_mudar
        self._estado: EstadoCircuito = Fechado()

    @property
    def nome_estado(self) -> NomeEstado:
        return self._estado.nome

    def permitir(self) -> bool:
        return self._estado.permitir(self)

    def registrar_sucesso(self) -> None:
        self._estado.sucesso(self)

    def registrar_falha(self) -> None:
        self._estado.falha(self)

    def transitar(self, novo: EstadoCircuito) -> None:
        antes = self._estado.nome
        if novo.nome == "FECHADO":
            self.falhas_seguidas = 0
        self._estado = novo
        if antes != novo.nome and self.ao_mudar:
            self.ao_mudar(antes, novo.nome)
