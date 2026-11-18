import { EventEnvelope } from "./messaging";
import { Observador } from "./observer";
import * as repo from "./repositorio";

/** Mantém o nome das equipes (vindo de equipe.criada / equipe.atualizada). */
export class ObservadorNomes implements Observador {
  tipos() { return ["equipe.criada", "equipe.atualizada"]; }
  async atualizar(e: EventEnvelope<any>) { await repo.upsertNome(e.payload.equipeId, e.payload.nome); }
}

/** Registra quem participa de cada torneio (vindo de equipe.validada). */
export class ObservadorParticipantes implements Observador {
  tipos() { return ["equipe.validada"]; }
  async atualizar(e: EventEnvelope<any>) {
    const { torneioId, equipeId, nomeEquipe } = e.payload;
    await repo.upsertNome(equipeId, nomeEquipe);
    await repo.addParticipante(torneioId, equipeId);
  }
}

/** Atualiza a classificação a cada resultado confirmado. */
export class ObservadorResultados implements Observador {
  tipos() { return ["resultado.confirmado"]; }
  async atualizar(e: EventEnvelope<any>) {
    const p = e.payload;
    await repo.addParticipante(p.torneioId, p.equipeAId);
    await repo.addParticipante(p.torneioId, p.equipeBId);
    await repo.inserirResultado({
      partidaId: p.partidaId, torneioId: p.torneioId, equipeAId: p.equipeAId, equipeBId: p.equipeBId,
      placarA: p.placarA, placarB: p.placarB, vencedorId: p.vencedorId,
    });
  }
}

/** Registra títulos (vindo de torneio.finalizado). */
export class ObservadorTitulos implements Observador {
  tipos() { return ["torneio.finalizado"]; }
  async atualizar(e: EventEnvelope<any>) { await repo.inserirTitulo(e.payload.torneioId, e.payload.campeaoId, e.payload.formato); }
}
