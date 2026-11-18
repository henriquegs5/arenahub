import { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { PartidaChave } from "./chave";
import { Formato } from "./formatos";
import { StatusTorneio } from "./estados";

export type Queryable = Pool | PoolClient;

export interface Torneio {
  id: string; nome: string; formato: Formato; maxEquipes: number;
  status: StatusTorneio; organizadorId: string; campeaoId: string | null;
}
export type StatusInscricao = "PENDENTE" | "CONFIRMADA" | "REJEITADA";
export interface Inscricao {
  id: string; torneioId: string; equipeId: string; solicitanteId: string;
  status: StatusInscricao; motivo: string | null; nomeEquipe: string | null;
}

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS torneios (
      id            UUID PRIMARY KEY,
      nome          TEXT NOT NULL,
      formato       TEXT NOT NULL,
      max_equipes   INT  NOT NULL,
      status        TEXT NOT NULL,
      organizador_id UUID NOT NULL,
      campeao_id    UUID,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS inscricoes (
      id             UUID PRIMARY KEY,
      torneio_id     UUID NOT NULL REFERENCES torneios(id),
      equipe_id      UUID NOT NULL,
      solicitante_id UUID NOT NULL,
      status         TEXT NOT NULL,
      motivo         TEXT,
      nome_equipe    TEXT,
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- A mesma equipe não pode ter duas inscrições ativas no mesmo torneio.
    CREATE UNIQUE INDEX IF NOT EXISTS inscricoes_ativa_unica
      ON inscricoes (torneio_id, equipe_id) WHERE status <> 'REJEITADA';
    CREATE TABLE IF NOT EXISTS chave_partidas (
      id          UUID PRIMARY KEY,
      torneio_id  UUID NOT NULL REFERENCES torneios(id),
      rodada      INT  NOT NULL,
      ordem       INT  NOT NULL,
      equipe_a    UUID NOT NULL,
      equipe_b    UUID,
      bye         BOOLEAN NOT NULL DEFAULT FALSE,
      status      TEXT NOT NULL,
      placar_a    INT,
      placar_b    INT,
      vencedor_id UUID
    );
    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
}

const mapT = (r: any): Torneio => ({
  id: r.id, nome: r.nome, formato: r.formato, maxEquipes: r.max_equipes,
  status: r.status, organizadorId: r.organizador_id, campeaoId: r.campeao_id,
});
const mapI = (r: any): Inscricao => ({
  id: r.id, torneioId: r.torneio_id, equipeId: r.equipe_id, solicitanteId: r.solicitante_id,
  status: r.status, motivo: r.motivo, nomeEquipe: r.nome_equipe,
});
const mapP = (r: any): PartidaChave =>
  new PartidaChave(r.id, r.rodada, r.ordem, r.equipe_a, r.equipe_b, r.bye, r.status, r.placar_a, r.placar_b, r.vencedor_id);

// ---------- torneios ----------
export async function criarTorneio(nome: string, formato: Formato, maxEquipes: number, organizadorId: string): Promise<Torneio> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO torneios (id, nome, formato, max_equipes, status, organizador_id) VALUES ($1,$2,$3,$4,'RASCUNHO',$5)",
    [id, nome, formato, maxEquipes, organizadorId]
  );
  return { id, nome, formato, maxEquipes, status: "RASCUNHO", organizadorId, campeaoId: null };
}

export async function buscarTorneio(id: string, q: Queryable = pool, travar = false): Promise<Torneio | null> {
  const r = await q.query(`SELECT * FROM torneios WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? mapT(r.rows[0]) : null;
}

export async function listarTorneios(): Promise<Torneio[]> {
  return (await pool.query("SELECT * FROM torneios ORDER BY criado_em DESC")).rows.map(mapT);
}

export async function atualizarStatus(q: Queryable, id: string, status: StatusTorneio, campeaoId: string | null = null) {
  await q.query("UPDATE torneios SET status = $2, campeao_id = COALESCE($3, campeao_id) WHERE id = $1", [id, status, campeaoId]);
}

// ---------- inscrições ----------
export async function contarAtivas(q: Queryable, torneioId: string): Promise<number> {
  const r = await q.query("SELECT count(*)::int AS n FROM inscricoes WHERE torneio_id = $1 AND status <> 'REJEITADA'", [torneioId]);
  return r.rows[0].n;
}
export async function contarPendentes(q: Queryable, torneioId: string): Promise<number> {
  const r = await q.query("SELECT count(*)::int AS n FROM inscricoes WHERE torneio_id = $1 AND status = 'PENDENTE'", [torneioId]);
  return r.rows[0].n;
}
export async function inserirInscricao(q: Queryable, torneioId: string, equipeId: string, solicitanteId: string): Promise<Inscricao> {
  const id = randomUUID();
  await q.query(
    "INSERT INTO inscricoes (id, torneio_id, equipe_id, solicitante_id, status) VALUES ($1,$2,$3,$4,'PENDENTE')",
    [id, torneioId, equipeId, solicitanteId]
  );
  return { id, torneioId, equipeId, solicitanteId, status: "PENDENTE", motivo: null, nomeEquipe: null };
}
export async function buscarInscricao(q: Queryable, id: string, travar = false): Promise<Inscricao | null> {
  const r = await q.query(`SELECT * FROM inscricoes WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? mapI(r.rows[0]) : null;
}
export async function atualizarInscricao(q: Queryable, id: string, status: StatusInscricao, motivo: string | null, nomeEquipe: string | null) {
  await q.query("UPDATE inscricoes SET status = $2, motivo = $3, nome_equipe = COALESCE($4, nome_equipe) WHERE id = $1", [id, status, motivo, nomeEquipe]);
}
export async function confirmadas(q: Queryable, torneioId: string): Promise<Inscricao[]> {
  return (await q.query("SELECT * FROM inscricoes WHERE torneio_id = $1 AND status = 'CONFIRMADA' ORDER BY criado_em", [torneioId])).rows.map(mapI);
}
export async function listarInscricoes(torneioId: string): Promise<Inscricao[]> {
  return (await pool.query("SELECT * FROM inscricoes WHERE torneio_id = $1 ORDER BY criado_em", [torneioId])).rows.map(mapI);
}

// ---------- chave ----------
export async function inserirPartida(q: Queryable, torneioId: string, p: PartidaChave) {
  await q.query(
    `INSERT INTO chave_partidas (id, torneio_id, rodada, ordem, equipe_a, equipe_b, bye, status, placar_a, placar_b, vencedor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [p.id, torneioId, p.rodada, p.ordem, p.equipeA, p.equipeB, p.bye, p.status, p.placarA, p.placarB, p.vencedorId]
  );
}
export async function carregarPartidas(q: Queryable, torneioId: string): Promise<PartidaChave[]> {
  return (await q.query("SELECT * FROM chave_partidas WHERE torneio_id = $1 ORDER BY rodada, ordem", [torneioId])).rows.map(mapP);
}
export async function salvarResultado(q: Queryable, p: PartidaChave) {
  await q.query(
    "UPDATE chave_partidas SET status = $2, placar_a = $3, placar_b = $4, vencedor_id = $5 WHERE id = $1",
    [p.id, p.status, p.placarA, p.placarB, p.vencedorId]
  );
}

// ---------- idempotência ----------
export async function marcarProcessado(eventId: string): Promise<boolean> {
  const r = await pool.query("INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
  return (r.rowCount ?? 0) > 0;
}
export async function desmarcarProcessado(eventId: string): Promise<void> {
  await pool.query("DELETE FROM eventos_processados WHERE event_id = $1", [eventId]);
}
