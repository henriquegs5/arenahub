import { EventEnvelope, publishEvent } from "./messaging";
import { montarCadeia } from "./eligibilidade";
import * as repo from "./repositorio";

interface InscricaoSolicitada {
  inscricaoId: string;
  torneioId: string;
  equipeId: string;
  solicitanteId: string;
}

/**
 * Participante da SAGA DE INSCRIÇÃO (coreografada).
 * Recebe inscricao.solicitada, valida a elegibilidade e responde com
 * equipe.validada ou equipe.rejeitada. Quem compensa (cancela a inscrição) é o Torneios.
 */
export async function tratarInscricaoSolicitada(event: EventEnvelope<InscricaoSolicitada>): Promise<void> {
  if (!(await repo.marcarProcessado(event.eventId))) return; // idempotência

  try {
    const { inscricaoId, torneioId, equipeId, solicitanteId } = event.payload;
    const equipe = await repo.porId(equipeId);
    const membros = equipe ? await repo.membrosDe(equipeId) : [];

    const motivo = montarCadeia().validar({ equipe, membros, solicitanteId });

    if (motivo) {
      publishEvent("equipe.rejeitada", 1, { inscricaoId, torneioId, equipeId, motivo }, event.correlationId);
    } else {
      publishEvent(
        "equipe.validada", 1,
        { inscricaoId, torneioId, equipeId, nomeEquipe: equipe!.nome },
        event.correlationId
      );
    }
  } catch (e) {
    await repo.desmarcarProcessado(event.eventId);
    throw e;
  }
}
