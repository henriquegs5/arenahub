import { montarAviso } from "./avisos";
import { Notificador } from "./canais";
import { EventEnvelope } from "./messaging";
import { Observador } from "./observer";

/** Observador de todos os eventos que geram aviso; entrega pelos canais (Adapter). */
export class ObservadorAvisos implements Observador {
  constructor(private readonly notificador: Notificador) {}
  tipos() { return ["usuario.registrado", "resultado.informado", "resultado.confirmado", "resultado.contestado", "torneio.finalizado"]; }
  async atualizar(e: EventEnvelope) {
    const aviso = montarAviso(e);
    if (aviso) await this.notificador.notificar(aviso);
  }
}
