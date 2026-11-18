/**
 * CIRCUIT BREAKER (padrão arquitetural) implementado com o padrão GoF STATE.
 *
 *  FECHADO ──(N falhas seguidas)──▶ ABERTO ──(passou o tempo)──▶ MEIO_ABERTO
 *     ▲                                ▲                              │
 *     └────────── sucesso ─────────────┼──────────────────────────────┤
 *                                      └──────────── falha ───────────┘
 *
 * FECHADO: tudo passa. ABERTO: recusa na hora (não sobrecarrega serviço doente).
 * MEIO_ABERTO: deixa passar UMA requisição de teste.
 */
export type NomeEstado = "FECHADO" | "ABERTO" | "MEIO_ABERTO";

export interface OpcoesBreaker {
  limiteFalhas: number;
  tempoAbertoMs: number;
  agora?: () => number;
  aoMudar?: (de: NomeEstado, para: NomeEstado) => void;
}

abstract class EstadoCircuito {
  abstract readonly nome: NomeEstado;
  abstract permitir(cb: CircuitBreaker): boolean;
  sucesso(_cb: CircuitBreaker): void {}
  falha(_cb: CircuitBreaker): void {}
}

class Fechado extends EstadoCircuito {
  readonly nome: NomeEstado = "FECHADO";
  permitir() { return true; }
  sucesso(cb: CircuitBreaker) { cb.falhasSeguidas = 0; }
  falha(cb: CircuitBreaker) {
    cb.falhasSeguidas++;
    if (cb.falhasSeguidas >= cb.limiteFalhas) cb.transitar(new Aberto(cb.agora()));
  }
}

class Aberto extends EstadoCircuito {
  readonly nome: NomeEstado = "ABERTO";
  constructor(private readonly abertoEm: number) { super(); }
  permitir(cb: CircuitBreaker) {
    if (cb.agora() - this.abertoEm < cb.tempoAbertoMs) return false;
    const meio = new MeioAberto();
    cb.transitar(meio);
    return meio.permitir(cb);
  }
}

class MeioAberto extends EstadoCircuito {
  readonly nome: NomeEstado = "MEIO_ABERTO";
  private sondaDesde: number | null = null;
  permitir(cb: CircuitBreaker) {
    // Só uma sonda por vez; se ela sumir (cliente desistiu), libera outra após o tempo.
    if (this.sondaDesde !== null && cb.agora() - this.sondaDesde < cb.tempoAbertoMs) return false;
    this.sondaDesde = cb.agora();
    return true;
  }
  sucesso(cb: CircuitBreaker) { cb.transitar(new Fechado()); }
  falha(cb: CircuitBreaker) { cb.transitar(new Aberto(cb.agora())); }
}

export class CircuitBreaker {
  falhasSeguidas = 0;
  readonly limiteFalhas: number;
  readonly tempoAbertoMs: number;
  readonly agora: () => number;
  private estado: EstadoCircuito = new Fechado();
  private readonly aoMudar?: OpcoesBreaker["aoMudar"];

  constructor(opcoes: OpcoesBreaker) {
    this.limiteFalhas = opcoes.limiteFalhas;
    this.tempoAbertoMs = opcoes.tempoAbertoMs;
    this.agora = opcoes.agora ?? Date.now;
    this.aoMudar = opcoes.aoMudar;
  }

  get nomeEstado(): NomeEstado { return this.estado.nome; }
  permitir(): boolean { return this.estado.permitir(this); }
  registrarSucesso(): void { this.estado.sucesso(this); }
  registrarFalha(): void { this.estado.falha(this); }

  transitar(novo: EstadoCircuito): void {
    const antes = this.estado.nome;
    if (novo.nome === "FECHADO") this.falhasSeguidas = 0;
    this.estado = novo;
    if (antes !== novo.nome) this.aoMudar?.(antes, novo.nome);
  }
}
