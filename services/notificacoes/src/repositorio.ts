import { pool } from "./db";

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notificacoes (
      id         UUID PRIMARY KEY,
      tipo       TEXT NOT NULL,
      titulo     TEXT NOT NULL,
      mensagem   TEXT NOT NULL,
      usuario_id UUID,
      torneio_id UUID,
      partida_id UUID,
      dados      JSONB NOT NULL DEFAULT '{}',
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
}

export async function listar(f: { usuarioId?: string; torneioId?: string; limite: number }) {
  const r = await pool.query(
    `SELECT id, tipo, titulo, mensagem, usuario_id, torneio_id, partida_id, criado_em
       FROM notificacoes
      WHERE ($1::uuid IS NULL OR usuario_id = $1) AND ($2::uuid IS NULL OR torneio_id = $2)
      ORDER BY criado_em DESC LIMIT $3`,
    [f.usuarioId ?? null, f.torneioId ?? null, f.limite]
  );
  return r.rows.map((x) => ({
    id: x.id, tipo: x.tipo, titulo: x.titulo, mensagem: x.mensagem,
    usuarioId: x.usuario_id, torneioId: x.torneio_id, partidaId: x.partida_id, criadoEm: x.criado_em,
  }));
}

export async function marcarProcessado(eventId: string): Promise<boolean> {
  const r = await pool.query("INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
  return (r.rowCount ?? 0) > 0;
}
export const desmarcarProcessado = (eventId: string) => pool.query("DELETE FROM eventos_processados WHERE event_id = $1", [eventId]);
