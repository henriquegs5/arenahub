import { montarAvisos } from "./avisos";
import { Notificador } from "./canais";
import { EventEnvelope } from "./messaging";
import { Observador } from "./observer";
import { estaRemovido, registrarRemovido, removerDoUsuario } from "./repositorio";

/**
 * Observador dos eventos que geram aviso ao participante.
 * Entrega por todos os canais que suportarem o aviso (Adapter).
 */
export class ObservadorAvisos implements Observador {
  constructor(private readonly notificador: Notificador) {}

  tipos() {
    return [
      "usuario.registrado",
      "usuario.atualizado",
      "ingresso.emitido",
      "pagamento.recusado",
      "pedido.cancelado",
      "estorno.concluido",
      "ingressos.afetados",
    ];
  }

  async atualizar(e: EventEnvelope) {
    for (const aviso of montarAvisos(e)) {
      // Conta ja excluida: nao ha para quem avisar, e o aviso ficaria orfao.
      if (aviso.usuarioId && (await estaRemovido(aviso.usuarioId))) continue;
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
    // Registra ANTES de apagar: um aviso que chegue em seguida ja encontra a marca.
    await registrarRemovido(usuarioId);
    const n = await removerDoUsuario(usuarioId);
    console.log(`[notificacoes] conta ${usuarioId} removida: ${n} aviso(s) descartado(s)`);
  }
}
