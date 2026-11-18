import { pool } from "./db";
import { Comando, ErroRegra, EventoSaida, Partida } from "./comandos";
import { EventEnvelope, publishEvent } from "./messaging";
import * as repo from "./repositorio";

/** Executa um comando sobre a partida em transação; publica os eventos só após o commit. */
export async function executar(partidaId: string, comando: Comando, correlationId: string): Promise<Partida> {
  const client = await pool.connect();
  let eventos: EventoSaida[];
  let partida: Partida;
  try {
    await client.query("BEGIN");
    const p = await repo.buscar(partidaId, client, true);
    if (!p) throw new ErroRegra(404, "partida não encontrada");
    eventos = comando.executar(p, correlationId);
    await repo.atualizar(client, p);
    await repo.registrarHistorico(client, p.id, comando.nome, comando.usuarioId, comando.dados(), p.status);
    await client.query("COMMIT");
    partida = p;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  for (const ev of eventos) publishEvent(ev.nome, 1, ev.payload, ev.correlationId);
  return partida;
}

interface ConfrontosGerados {
  torneioId: string;
  formato: Partida["formato"];
  organizadorId: string;
  partidas: { partidaId: string; rodada: number; equipeAId: string; equipeBId: string; capitaoAId: string; capitaoBId: string }[];
}

/** Cria as partidas AGENDADA a partir dos confrontos gerados pelo Torneios (idempotente). */
export async function tratarConfrontosGerados(event: EventEnvelope<ConfrontosGerados>): Promise<void> {
  if (!(await repo.marcarProcessado(event.eventId))) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { torneioId, formato, organizadorId, partidas } = event.payload;
    for (const x of partidas) {
      await repo.inserirNova(client, {
        id: x.partidaId, torneioId, formato, organizadorId, rodada: x.rodada,
        equipeAId: x.equipeAId, equipeBId: x.equipeBId, capitaoAId: x.capitaoAId, capitaoBId: x.capitaoBId,
        status: "AGENDADA", placarA: null, placarB: null, informadoPor: null, contestadoPor: null, motivoContestacao: null,
      });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    await repo.desmarcarProcessado(event.eventId);
    throw e;
  } finally {
    client.release();
  }
}
