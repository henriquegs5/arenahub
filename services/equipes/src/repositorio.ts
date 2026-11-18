import { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { pool } from "./db";

export interface Equipe {
  id: string;
  nome: string;
  capitaoId: string;
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
    );`);
}

const map = (r: any): Equipe => ({ id: r.id, nome: r.nome, capitaoId: r.capitao_id });

export async function criar(nome: string, capitaoId: string): Promise<Equipe> {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO equipes (id, nome, capitao_id) VALUES ($1,$2,$3)", [id, nome, capitaoId]);
    await client.query("INSERT INTO membros (usuario_id, equipe_id) VALUES ($1,$2)", [capitaoId, id]);
    await client.query("COMMIT");
    return { id, nome, capitaoId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function porId(id: string): Promise<Equipe | null> {
  const r = await pool.query("SELECT * FROM equipes WHERE id = $1", [id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

export async function listar(): Promise<Equipe[]> {
  const r = await pool.query("SELECT * FROM equipes ORDER BY criado_em");
  return r.rows.map(map);
}

export async function membrosDe(equipeId: string): Promise<string[]> {
  const r = await pool.query("SELECT usuario_id FROM membros WHERE equipe_id = $1 ORDER BY entrou_em", [equipeId]);
  return r.rows.map((x) => x.usuario_id);
}

export async function renomear(id: string, nome: string): Promise<void> {
  await pool.query("UPDATE equipes SET nome = $2 WHERE id = $1", [id, nome]);
}

/** Adiciona membro respeitando o limite; trava a linha da equipe para evitar corrida. */
export async function adicionarMembro(equipeId: string, usuarioId: string, max: number): Promise<"ok" | "cheia"> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM equipes WHERE id = $1 FOR UPDATE", [equipeId]);
    const c = await client.query("SELECT count(*)::int AS n FROM membros WHERE equipe_id = $1", [equipeId]);
    if (c.rows[0].n >= max) {
      await client.query("ROLLBACK");
      return "cheia";
    }
    await client.query("INSERT INTO membros (usuario_id, equipe_id) VALUES ($1,$2)", [usuarioId, equipeId]);
    await client.query("COMMIT");
    return "ok";
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function removerMembro(equipeId: string, usuarioId: string): Promise<boolean> {
  const r = await pool.query("DELETE FROM membros WHERE equipe_id = $1 AND usuario_id = $2", [equipeId, usuarioId]);
  return (r.rowCount ?? 0) > 0;
}

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
