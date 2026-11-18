import { EventEnvelope } from "./messaging";
import { Aviso } from "./canais";

const curto = (id: string) => String(id).slice(0, 8);

/** Traduz um evento de domínio em um aviso legível. null = evento sem aviso. */
export function montarAviso(e: EventEnvelope<any>): Aviso | null {
  const p = e.payload;
  const base = { usuarioId: null, torneioId: null, partidaId: null, dados: p, email: null, ocorridoEm: e.occurredAt ?? null };
  switch (e.type) {
    case "usuario.registrado":
      return { ...base, tipo: "USUARIO_REGISTRADO", titulo: "Bem-vindo ao ArenaHub",
        mensagem: `Olá, ${p.nome}! Sua conta (${p.papel}) foi criada.`, usuarioId: p.usuarioId, email: p.email };
    case "resultado.informado":
      return { ...base, tipo: "RESULTADO_INFORMADO", titulo: "Resultado informado",
        mensagem: `Partida ${curto(p.partidaId)}: ${p.placarA} x ${p.placarB}. Aguardando confirmação do organizador.`,
        torneioId: p.torneioId, partidaId: p.partidaId };
    case "resultado.confirmado":
      return { ...base, tipo: "RESULTADO_CONFIRMADO", titulo: "Resultado confirmado",
        mensagem: `Partida ${curto(p.partidaId)}: ${p.placarA} x ${p.placarB}. ` +
          (p.vencedorId ? `Vencedora: equipe ${curto(p.vencedorId)}.` : "Empate."),
        torneioId: p.torneioId, partidaId: p.partidaId };
    case "resultado.contestado":
      return { ...base, tipo: "RESULTADO_CONTESTADO", titulo: "Resultado contestado",
        mensagem: `Partida ${curto(p.partidaId)} contestada. Motivo: ${p.motivo}`,
        torneioId: p.torneioId, partidaId: p.partidaId };
    case "torneio.finalizado":
      return { ...base, tipo: "TORNEIO_FINALIZADO", titulo: "Torneio finalizado",
        mensagem: `Torneio ${curto(p.torneioId)} encerrado. Campeã: equipe ${curto(p.campeaoId)}.`,
        torneioId: p.torneioId };
    default:
      return null;
  }
}
