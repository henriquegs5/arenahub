import { pool } from "./db";

/**
 * Migrações na subida do serviço, com CREATE TABLE IF NOT EXISTS, de forma que o
 * serviço suba tanto num banco vazio quanto num já existente.
 *
 * O domínio de eventos (evento, setores, lotes, reserva de lugares) entra no lote 2.
 */
export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
}

/**
 * IDEMPOTÊNCIA DE CONSUMO: todo consumidor registra o eventId antes de agir.
 * Devolve false quando o evento já foi processado (entrega repetida do broker).
 */
export async function marcarProcessado(eventId: string): Promise<boolean> {
  const r = await pool.query("INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
  return (r.rowCount ?? 0) > 0;
}

/** Desfaz a marca quando o tratamento falhou, para que o evento possa ser repetido. */
export async function desmarcarProcessado(eventId: string): Promise<void> {
  await pool.query("DELETE FROM eventos_processados WHERE event_id = $1", [eventId]);
}
