import { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { StatusSolicitacao } from "./estados";

export type Queryable = Pool | PoolClient;

export interface Equipe {
  id: string;
  nome: string;
  capitaoId: string;
}

export interface EquipeComMembros extends Equipe {
  membros: string[];
}

export interface Solicitacao {
  id: string;
  equipeId: string;
  usuarioId: string;
  status: StatusSolicitacao;
  motivo: string | null;
  criadoEm: string;
  resolvidoEm: string | null;
  resolvidoPor: string | null;
}

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS equipes (
      id          UUID PRIMARY KEY,
      nome        TEXT NOT NULL UNIQUE,
      capitao_id  UUID NOT NULL,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- usuario_id como chave: um usuário só pode estar em UMA equipe.
    -- Guardamos apenas o ID do usuário (o dono dos dados é o serviço Identidade).
    CREATE TABLE IF NOT EXISTS membros (
      usuario_id  UUID PRIMARY KEY,
      equipe_id   UUID NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
      entrou_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Idempotência dos consumidores de eventos.
    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Pedidos de entrada numa equipe (ciclo de vida em estados.ts).
    CREATE TABLE IF NOT EXISTS solicitacoes (
      id            UUID PRIMARY KEY,
      equipe_id     UUID NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
      usuario_id    UUID NOT NULL,
      status        TEXT NOT NULL,
      motivo        TEXT,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolvido_em  TIMESTAMPTZ,
      resolvido_por UUID
    );
    -- Um jogador tem no máximo UMA solicitação pendente de cada vez.
    CREATE UNIQUE INDEX IF NOT EXISTS solicitacoes_pendente_unica
      ON solicitacoes (usuario_id) WHERE status = 'PENDENTE';
    CREATE INDEX IF NOT EXISTS solicitacoes_por_equipe ON solicitacoes (equipe_id, status);
    -- Cópia local do nome dos usuários, alimentada por eventos da Identidade.
    -- Serve para que os eventos publicados daqui carreguem nomes legíveis,
    -- sem que este serviço consulte o serviço de Identidade.
    CREATE TABLE IF NOT EXISTS nomes_usuarios (
      usuario_id UUID PRIMARY KEY,
      nome       TEXT NOT NULL
    );
    -- Compromissos da equipe em torneios, derivados de eventos do serviço Torneios.
    -- É o que permite bloquear o desfazimento de uma equipe com inscrição ativa
    -- sem que este serviço precise perguntar nada ao Torneios.
    CREATE TABLE IF NOT EXISTS compromissos (
      equipe_id    UUID NOT NULL,
      torneio_id   UUID NOT NULL,
      nome_torneio TEXT NOT NULL,
      encerrado    BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (equipe_id, torneio_id)
    );`);
}

const map = (r: any): Equipe => ({ id: r.id, nome: r.nome, capitaoId: r.capitao_id });
const mapS = (r: any): Solicitacao => ({
  id: r.id, equipeId: r.equipe_id, usuarioId: r.usuario_id, status: r.status, motivo: r.motivo,
  criadoEm: r.criado_em, resolvidoEm: r.resolvido_em, resolvidoPor: r.resolvido_por,
});

// ---------- equipes ----------
export async function criar(q: Queryable, nome: string, capitaoId: string): Promise<Equipe> {
  const id = randomUUID();
  await q.query("INSERT INTO equipes (id, nome, capitao_id) VALUES ($1,$2,$3)", [id, nome, capitaoId]);
  await q.query("INSERT INTO membros (usuario_id, equipe_id) VALUES ($1,$2)", [capitaoId, id]);
  return { id, nome, capitaoId };
}

export async function porId(id: string, q: Queryable = pool, travar = false): Promise<Equipe | null> {
  const r = await q.query(`SELECT * FROM equipes WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

/** Listagem já com os membros: evita uma requisição por equipe no frontend. */
export async function listarComMembros(): Promise<EquipeComMembros[]> {
  const r = await pool.query(`
    SELECT e.id, e.nome, e.capitao_id,
           COALESCE(ARRAY_AGG(m.usuario_id ORDER BY m.entrou_em) FILTER (WHERE m.usuario_id IS NOT NULL), '{}') AS membros
      FROM equipes e
      LEFT JOIN membros m ON m.equipe_id = e.id
     GROUP BY e.id, e.nome, e.capitao_id, e.criado_em
     ORDER BY e.criado_em`);
  return r.rows.map((x) => ({ ...map(x), membros: x.membros as string[] }));
}

export async function membrosDe(equipeId: string, q: Queryable = pool): Promise<string[]> {
  const r = await q.query("SELECT usuario_id FROM membros WHERE equipe_id = $1 ORDER BY entrou_em", [equipeId]);
  return r.rows.map((x) => x.usuario_id as string);
}

export async function equipeDoUsuario(usuarioId: string, q: Queryable = pool): Promise<string | null> {
  const r = await q.query("SELECT equipe_id FROM membros WHERE usuario_id = $1", [usuarioId]);
  return r.rows[0]?.equipe_id ?? null;
}

export async function renomear(q: Queryable, id: string, nome: string): Promise<void> {
  await q.query("UPDATE equipes SET nome = $2 WHERE id = $1", [id, nome]);
}

export async function trocarCapitao(q: Queryable, id: string, capitaoId: string): Promise<void> {
  await q.query("UPDATE equipes SET capitao_id = $2 WHERE id = $1", [id, capitaoId]);
}

export async function removerEquipe(q: Queryable, id: string): Promise<void> {
  await q.query("DELETE FROM equipes WHERE id = $1", [id]); // membros e solicitações saem em cascata
}

/** Insere o membro respeitando o limite. Exige que a equipe já esteja travada. */
export async function adicionarMembro(q: Queryable, equipeId: string, usuarioId: string, max: number): Promise<"ok" | "cheia"> {
  const c = await q.query("SELECT count(*)::int AS n FROM membros WHERE equipe_id = $1", [equipeId]);
  if (c.rows[0].n >= max) return "cheia";
  await q.query("INSERT INTO membros (usuario_id, equipe_id) VALUES ($1,$2)", [usuarioId, equipeId]);
  return "ok";
}

export async function removerMembro(q: Queryable, equipeId: string, usuarioId: string): Promise<boolean> {
  const r = await q.query("DELETE FROM membros WHERE equipe_id = $1 AND usuario_id = $2", [equipeId, usuarioId]);
  return (r.rowCount ?? 0) > 0;
}

/** Remove o usuário de qualquer equipe; devolve a equipe de onde saiu. */
export async function removerDeQualquerEquipe(q: Queryable, usuarioId: string): Promise<string | null> {
  const r = await q.query("DELETE FROM membros WHERE usuario_id = $1 RETURNING equipe_id", [usuarioId]);
  return r.rows[0]?.equipe_id ?? null;
}

// ---------- solicitações ----------
export async function criarSolicitacao(q: Queryable, equipeId: string, usuarioId: string): Promise<Solicitacao> {
  const id = randomUUID();
  const r = await q.query(
    "INSERT INTO solicitacoes (id, equipe_id, usuario_id, status) VALUES ($1,$2,$3,'PENDENTE') RETURNING *",
    [id, equipeId, usuarioId]
  );
  return mapS(r.rows[0]);
}

export async function buscarSolicitacao(id: string, q: Queryable = pool, travar = false): Promise<Solicitacao | null> {
  const r = await q.query(`SELECT * FROM solicitacoes WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? mapS(r.rows[0]) : null;
}

export async function resolverSolicitacao(
  q: Queryable, id: string, status: StatusSolicitacao, resolvidoPor: string, motivo: string | null
): Promise<void> {
  await q.query(
    "UPDATE solicitacoes SET status = $2, resolvido_em = now(), resolvido_por = $3, motivo = $4 WHERE id = $1",
    [id, status, resolvidoPor, motivo]
  );
}

/** Cancela em lote as pendências de um usuário (ao entrar numa equipe ou sair da plataforma). */
export async function cancelarPendentesDoUsuario(q: Queryable, usuarioId: string, motivo: string): Promise<Solicitacao[]> {
  const r = await q.query(
    `UPDATE solicitacoes SET status = 'CANCELADA', resolvido_em = now(), resolvido_por = $1, motivo = $2
      WHERE usuario_id = $1 AND status = 'PENDENTE' RETURNING *`,
    [usuarioId, motivo]
  );
  return r.rows.map(mapS);
}

export async function solicitacoesDaEquipe(equipeId: string, apenasPendentes: boolean): Promise<Solicitacao[]> {
  const r = await pool.query(
    `SELECT * FROM solicitacoes WHERE equipe_id = $1 ${apenasPendentes ? "AND status = 'PENDENTE'" : ""}
      ORDER BY criado_em DESC`,
    [equipeId]
  );
  return r.rows.map(mapS);
}

export async function solicitacoesDoUsuario(usuarioId: string): Promise<Solicitacao[]> {
  const r = await pool.query("SELECT * FROM solicitacoes WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 50", [usuarioId]);
  return r.rows.map(mapS);
}

// ---------- nomes de usuários (cópia alimentada por eventos) ----------
export async function upsertNomeUsuario(q: Queryable, usuarioId: string, nome: string): Promise<void> {
  await q.query(
    "INSERT INTO nomes_usuarios (usuario_id, nome) VALUES ($1,$2) ON CONFLICT (usuario_id) DO UPDATE SET nome = EXCLUDED.nome",
    [usuarioId, nome]
  );
}

export async function esquecerUsuario(q: Queryable, usuarioId: string): Promise<void> {
  await q.query("DELETE FROM nomes_usuarios WHERE usuario_id = $1", [usuarioId]);
}

export async function nomeDe(usuarioId: string, q: Queryable = pool): Promise<string> {
  const r = await q.query("SELECT nome FROM nomes_usuarios WHERE usuario_id = $1", [usuarioId]);
  return r.rows[0]?.nome ?? "Jogador";
}

export async function nomesDe(ids: string[], q: Queryable = pool): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const r = await q.query("SELECT usuario_id, nome FROM nomes_usuarios WHERE usuario_id = ANY($1::uuid[])", [ids]);
  return new Map(r.rows.map((x) => [x.usuario_id as string, x.nome as string]));
}

// ---------- compromissos em torneios ----------
export async function registrarCompromisso(q: Queryable, equipeId: string, torneioId: string, nomeTorneio: string): Promise<void> {
  await q.query(
    `INSERT INTO compromissos (equipe_id, torneio_id, nome_torneio, encerrado) VALUES ($1,$2,$3,FALSE)
     ON CONFLICT (equipe_id, torneio_id) DO UPDATE SET encerrado = FALSE, nome_torneio = EXCLUDED.nome_torneio`,
    [equipeId, torneioId, nomeTorneio]
  );
}

export async function encerrarCompromisso(q: Queryable, equipeId: string, torneioId: string): Promise<void> {
  await q.query("DELETE FROM compromissos WHERE equipe_id = $1 AND torneio_id = $2", [equipeId, torneioId]);
}

export async function encerrarCompromissosDoTorneio(q: Queryable, torneioId: string): Promise<void> {
  await q.query("UPDATE compromissos SET encerrado = TRUE WHERE torneio_id = $1", [torneioId]);
}

export async function compromissosAtivos(equipeId: string, q: Queryable = pool): Promise<{ torneioId: string; nomeTorneio: string }[]> {
  const r = await q.query(
    "SELECT torneio_id, nome_torneio FROM compromissos WHERE equipe_id = $1 AND encerrado = FALSE",
    [equipeId]
  );
  return r.rows.map((x) => ({ torneioId: x.torneio_id as string, nomeTorneio: x.nome_torneio as string }));
}

export async function limparCompromissosDaEquipe(q: Queryable, equipeId: string): Promise<void> {
  await q.query("DELETE FROM compromissos WHERE equipe_id = $1", [equipeId]);
}

// ---------- idempotência ----------
/** true = evento novo (deve processar); false = já processado (descartar). */
export async function marcarProcessado(eventId: string): Promise<boolean> {
  const r = await pool.query(
    "INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [eventId]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function desmarcarProcessado(eventId: string): Promise<void> {
  await pool.query("DELETE FROM eventos_processados WHERE event_id = $1", [eventId]);
}
