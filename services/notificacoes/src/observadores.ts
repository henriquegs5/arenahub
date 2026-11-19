import { montarAvisos } from "./avisos";
import { Notificador } from "./canais";
import { EventEnvelope } from "./messaging";
import { Observador } from "./observer";
import { removerDoUsuario } from "./repositorio";

/**
 * Observador dos eventos que geram aviso ao participante.
 * Entrega por todos os canais que suportarem o aviso (Adapter).
 */
export class ObservadorAvisos implements Observador {
  constructor(private readonly notificador: Notificador) {}

  tipos() {
    return ["usuario.registrado", "usuario.atualizado"];
  }

  async atualizar(e: EventEnvelope) {
    for (const aviso of montarAvisos(e)) {
      await this.notificador.notificar(aviso);
    }
  }
}

/**
 * Integridade: conta excluída não deixa avisos órfãos para trás.
 * É a compensação deste serviço para `usuario.removido`.
 */
export class ObservadorUsuarioRemovido implements Observador {
  tipos() {
    return ["usuario.removido"];
  }

  async atualizar(e: EventEnvelope) {
    const usuarioId = (e.payload as { usuarioId?: string })?.usuarioId;
    if (!usuarioId) return;
    const n = await removerDoUsuario(usuarioId);
    console.log(`[notificacoes] conta ${usuarioId} removida: ${n} aviso(s) descartado(s)`);
  }
}
