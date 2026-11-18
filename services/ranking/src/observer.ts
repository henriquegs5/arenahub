import { EventEnvelope } from "./messaging";

/**
 * Padrão GoF: OBSERVER.
 * O Despachante (subject) recebe cada evento do broker e avisa apenas os
 * observadores interessados naquele tipo. Novos comportamentos entram como novos
 * observadores, sem alterar o consumidor de mensagens.
 */
export interface Observador {
  tipos(): string[];
  atualizar(evento: EventEnvelope): Promise<void>;
}

export class DespachanteEventos {
  private observadores: Observador[] = [];

  assinar(o: Observador): this {
    this.observadores.push(o);
    return this;
  }

  async notificar(evento: EventEnvelope): Promise<void> {
    for (const o of this.observadores) {
      if (o.tipos().includes(evento.type)) await o.atualizar(evento);
    }
  }
}

