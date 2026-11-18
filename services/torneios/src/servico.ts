import { PoolClient } from "pg";
import { pool } from "./db";
import { Chave, PartidaChave } from "./chave";
import { estadoDe } from "./estados";
import { criadorPara, Formato } from "./formatos";
import { EventEnvelope, publishEvent } from "./messaging";
import * as repo from "./repositorio";

export class ErroNegocio extends Error {
  constructor(public readonly status: number, mensagem: string) { super(mensagem); }
}

interface EventoSaida { nome: string; payload: unknown; correlationId: string }

/** Executa em transação e só publica os eventos DEPOIS do commit. */
async function transacao(fn: (c: PoolClient) => Promise<EventoSaida[]>): Promise<void> {
  const client = await pool.connect();
  let eventos: EventoSaida[];
  try {
    await client.query("BEGIN");
    eventos = await fn(client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  for (const ev of eventos) publishEvent(ev.nome, 1, ev.payload, ev.correlationId);
}

async function torneioDoOrganizador(c: PoolClient, id: string, usuarioId: string) {
  const t = await repo.buscarTorneio(id, c, true);
  if (!t) throw new ErroNegocio(404, "torneio não encontrado");
  if (t.organizadorId !== usuarioId) throw new ErroNegocio(403, "somente o organizador do torneio pode fazer isso");
  return t;
}

/** Capitão de cada equipe = quem a inscreveu (validado como capitão pela Equipes na Saga). */
type Capitaes = Map<string, string>;

const confrontosGerados = (
  t: { id: string; formato: Formato; organizadorId: string },
  partidas: PartidaChave[],
  capitaes: Capitaes,
  correlationId: string
): EventoSaida => ({
  nome: "confrontos.gerados",
  correlationId,
  payload: {
    torneioId: t.id,
    formato: t.formato,
    organizadorId: t.organizadorId,
    partidas: partidas.filter((p) => !p.bye).map((p) => ({
      partidaId: p.id, rodada: p.rodada,
      equipeAId: p.equipeA, equipeBId: p.equipeB,
      capitaoAId: capitaes.get(p.equipeA), capitaoBId: capitaes.get(p.equipeB!),
    })),
  },
});

// ================= comandos vindos da API =================
export async function abrirInscricoes(id: string, usuarioId: string): Promise<void> {
  await transacao(async (c) => {
    const t = await torneioDoOrganizador(c, id, usuarioId);
    await repo.atualizarStatus(c, id, estadoDe(t.status).abrirInscricoes().nome);
    return [];
  });
}

export async function cancelar(id: string, usuarioId: string): Promise<void> {
  await transacao(async (c) => {
    const t = await torneioDoOrganizador(c, id, usuarioId);
    await repo.atualizarStatus(c, id, estadoDe(t.status).cancelar().nome);
    return [];
  });
}

/** Início da SAGA DE INSCRIÇÃO: cria a inscrição PENDENTE e pede validação à Equipes. */
export async function inscrever(torneioId: string, equipeId: string, solicitanteId: string, correlationId: string): Promise<void> {
  await transacao(async (c) => {
    const t = await repo.buscarTorneio(torneioId, c, true);
    if (!t) throw new ErroNegocio(404, "torneio não encontrado");
    if (!estadoDe(t.status).aceitaInscricoes()) throw new ErroNegocio(409, "inscrições não estão abertas");
    // PENDENTE e CONFIRMADA ocupam vaga; REJEITADA libera (compensação).
    if ((await repo.contarAtivas(c, torneioId)) >= t.maxEquipes) throw new ErroNegocio(409, "vagas esgotadas");
    const insc = await repo.inserirInscricao(c, torneioId, equipeId, solicitanteId);
    return [{
      nome: "inscricao.solicitada", correlationId,
      payload: { inscricaoId: insc.id, torneioId, equipeId, solicitanteId },
    }];
  });
}

export async function iniciar(id: string, usuarioId: string, correlationId: string): Promise<void> {
  await transacao(async (c) => {
    const t = await torneioDoOrganizador(c, id, usuarioId);
    const proximo = estadoDe(t.status).iniciar();
    if ((await repo.contarPendentes(c, id)) > 0) throw new ErroNegocio(409, "existem inscrições pendentes de validação");
    const inscritas = await repo.confirmadas(c, id);
    const equipes = inscritas.map((i) => i.equipeId);
    const capitaes: Capitaes = new Map(inscritas.map((i) => [i.equipeId, i.solicitanteId]));
    if (equipes.length < 2) throw new ErroNegocio(409, "são necessárias ao menos 2 equipes confirmadas");

    const chave = criadorPara(t.formato).criarEstrategia().gerarChaveInicial(equipes);
    const partidas = chave.partidas();
    for (const p of partidas) await repo.inserirPartida(c, id, p);
    await repo.atualizarStatus(c, id, proximo.nome);
    return [confrontosGerados(t, partidas, capitaes, correlationId)];
  });
}

// ================= reações a eventos =================
async function idempotente(event: EventEnvelope, fn: () => Promise<void>): Promise<void> {
  if (!(await repo.marcarProcessado(event.eventId))) return;
  try {
    await fn();
  } catch (e) {
    await repo.desmarcarProcessado(event.eventId);
    throw e;
  }
}

/** Saga: equipe aprovada → confirma a inscrição (ou compensa se o torneio já fechou). */
export function tratarEquipeValidada(event: EventEnvelope<{ inscricaoId: string; torneioId: string; nomeEquipe: string }>) {
  return idempotente(event, () => transacao(async (c) => {
    const { inscricaoId, torneioId, nomeEquipe } = event.payload;
    const t = await repo.buscarTorneio(torneioId, c, true);
    const insc = await repo.buscarInscricao(c, inscricaoId, true);
    if (!t || !insc || insc.status !== "PENDENTE") return [];
    if (!estadoDe(t.status).aceitaInscricoes()) {
      await repo.atualizarInscricao(c, inscricaoId, "REJEITADA", "inscrições encerradas antes da validação", nomeEquipe);
    } else {
      await repo.atualizarInscricao(c, inscricaoId, "CONFIRMADA", null, nomeEquipe);
    }
    return [];
  }));
}

/** Saga (compensação): equipe reprovada → rejeita a inscrição e libera a vaga. */
export function tratarEquipeRejeitada(event: EventEnvelope<{ inscricaoId: string; torneioId: string; motivo: string }>) {
  return idempotente(event, () => transacao(async (c) => {
    const { inscricaoId, torneioId, motivo } = event.payload;
    await repo.buscarTorneio(torneioId, c, true);
    const insc = await repo.buscarInscricao(c, inscricaoId, true);
    if (!insc || insc.status !== "PENDENTE") return [];
    await repo.atualizarInscricao(c, inscricaoId, "REJEITADA", motivo, null);
    return [];
  }));
}

interface ResultadoConfirmado {
  partidaId: string; torneioId: string; placarA: number; placarB: number; vencedorId: string | null;
}

/** Registra o resultado na chave e avança de fase ou finaliza o torneio. */
export function tratarResultadoConfirmado(event: EventEnvelope<ResultadoConfirmado>) {
  return idempotente(event, () => transacao(async (c) => {
    const p = event.payload;
    const t = await repo.buscarTorneio(p.torneioId, c, true);
    if (!t || t.status !== "EM_ANDAMENTO") return [];

    const partidas = await repo.carregarPartidas(c, p.torneioId);
    const alvo = partidas.find((x) => x.id === p.partidaId);
    if (!alvo || alvo.concluido()) return [];
    if (t.formato === "ELIMINACAO_SIMPLES" && !p.vencedorId) throw new Error("empate não é permitido em eliminação simples");

    alvo.registrar(p.placarA, p.placarB, p.vencedorId);
    await repo.salvarResultado(c, alvo);

    const estrategia = criadorPara(t.formato).criarEstrategia();
    const chave = Chave.deRegistros(partidas);

    if (estrategia.terminou(chave)) {
      const campeaoId = estrategia.campeao(chave);
      await repo.atualizarStatus(c, t.id, estadoDe(t.status).finalizar().nome, campeaoId);
      return [{ nome: "torneio.finalizado", correlationId: event.correlationId, payload: { torneioId: t.id, campeaoId, formato: t.formato } }];
    }

    const proxima = estrategia.avancar(chave);
    if (!proxima) return [];
    const novas = proxima.partidas();
    for (const n of novas) await repo.inserirPartida(c, t.id, n);
    const capitaes: Capitaes = new Map((await repo.confirmadas(c, t.id)).map((i) => [i.equipeId, i.solicitanteId]));
    return [confrontosGerados(t, novas, capitaes, event.correlationId)];
  }));
}
