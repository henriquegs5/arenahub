import { PoolClient } from "pg";
import { pool } from "./db";
import { Partida } from "./comandos";

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partidas (
      id                 UUID PRIMARY KEY,
      torneio_id         UUID NOT NULL,
      formato            TEXT NOT NULL,
      organizador_id     UUID NOT NULL,
      rodada             INT  NOT NULL,
      equipe_a_id        UUID NOT NULL,
      equipe_b_id        UUID NOT NULL,
      capitao_a_id       UUID NOT NULL,
      capitao_b_id       UUID NOT NULL,
      status             TEXT NOT NULL,
      placar_a           INT,
      placar_b           INT,
      informado_por      UUID,
      contestado_por     UUID,
      motivo_contestacao TEXT,
      criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Histórico: cada comando executado (quem fez o quê e quando).
    CREATE TABLE IF NOT EXISTS historico_comandos (
      id            BIGSERIAL PRIMARY KEY,
      partida_id    UUID NOT NULL REFERENCES partidas(id),
      comando       TEXT NOT NULL,
      usuario_id    UUID NOT NULL,
      dados         JSONB NOT NULL DEFAULT '{}',
      status_apos   TEXT NOT NULL,
      executado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
}

const map = (r: any): Partida => ({
  id: r.id, torneioId: r.torneio_id, formato: r.formato, organizadorId: r.organizador_id, rodada: r.rodada,
  equipeAId: r.equipe_a_id, equipeBId: r.equipe_b_id, capitaoAId: r.capitao_a_id, capitaoBId: r.capitao_b_id,
  status: r.status, placarA: r.placar_a, placarB: r.placar_b,
  informadoPor: r.informado_por, contestadoPor: r.contestado_por, motivoContestacao: r.motivo_contestacao,
});

export async function inserirNova(c: PoolClient, p: Partida) {
  await c.query(
    `INSERT INTO partidas (id, torneio_id, formato, organizador_id, rodada, equipe_a_id, equipe_b_id, capitao_a_id, capitao_b_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AGENDADA') ON CONFLICT (id) DO NOTHING`,
    [p.id, p.torneioId, p.formato, p.organizadorId, p.rodada, p.equipeAId, p.equipeBId, p.capitaoAId, p.capitaoBId]
  );
}

export async function buscar(id: string, c: PoolClient | typeof pool = pool, travar = false): Promise<Partida | null> {
  const r = await c.query(`SELECT * FROM partidas WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

export async function listar(filtros: { torneioId?: string; status?: string }): Promise<Partida[]> {
  const r = await pool.query(
    `SELECT * FROM partidas
      WHERE ($1::uuid IS NULL OR torneio_id = $1) AND ($2::text IS NULL OR status = $2)
      ORDER BY torneio_id, rodada, criado_em`,
    [filtros.torneioId ?? null, filtros.status ?? null]
  );
  return r.rows.map(map);
}

export async function atualizar(c: PoolClient, p: Partida) {
  await c.query(
    `UPDATE partidas SET status=$2, placar_a=$3, placar_b=$4, informado_por=$5, contestado_por=$6, motivo_contestacao=$7 WHERE id=$1`,
    [p.id, p.status, p.placarA, p.placarB, p.informadoPor, p.contestadoPor, p.motivoContestacao]
  );
}

export async function registrarHistorico(c: PoolClient, partidaId: string, comando: string, usuarioId: string, dados: object, statusApos: string) {
  await c.query(
    "INSERT INTO historico_comandos (partida_id, comando, usuario_id, dados, status_apos) VALUES ($1,$2,$3,$4,$5)",
    [partidaId, comando, usuarioId, JSON.stringify(dados), statusApos]
  );
}

export async function historico(partidaId: string) {
  const r = await pool.query(
    "SELECT comando, usuario_id, dados, status_apos, executado_em FROM historico_comandos WHERE partida_id = $1 ORDER BY id",
    [partidaId]
  );
  return r.rows.map((x) => ({ comando: x.comando, usuarioId: x.usuario_id, dados: x.dados, statusApos: x.status_apos, executadoEm: x.executado_em }));
}

export async function marcarProcessado(eventId: string): Promise<boolean> {
  const r = await pool.query("INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
  return (r.rowCount ?? 0) > 0;
}
export async function desmarcarProcessado(eventId: string): Promise<void> {
  await pool.query("DELETE FROM eventos_processados WHERE event_id = $1", [eventId]);
}
