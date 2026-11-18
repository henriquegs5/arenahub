import { pool } from "./db";
import { ResultadoPartida } from "./classificacao";

export async function migrate(): Promise<void> {
  await pool.query(`
    -- Dados derivados de eventos (o Ranking não consulta outros serviços).
    CREATE TABLE IF NOT EXISTS nomes_equipes (
      equipe_id UUID PRIMARY KEY,
      nome      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS participantes (
      torneio_id UUID NOT NULL,
      equipe_id  UUID NOT NULL,
      PRIMARY KEY (torneio_id, equipe_id)
    );
    CREATE TABLE IF NOT EXISTS resultados (
      partida_id  UUID PRIMARY KEY,
      torneio_id  UUID NOT NULL,
      equipe_a_id UUID NOT NULL,
      equipe_b_id UUID NOT NULL,
      placar_a    INT  NOT NULL,
      placar_b    INT  NOT NULL,
      vencedor_id UUID
    );
    CREATE TABLE IF NOT EXISTS titulos (
      torneio_id UUID PRIMARY KEY,
      campeao_id UUID NOT NULL,
      formato    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
}

export const upsertNome = (equipeId: string, nome: string) =>
  pool.query(
    "INSERT INTO nomes_equipes (equipe_id, nome) VALUES ($1,$2) ON CONFLICT (equipe_id) DO UPDATE SET nome = EXCLUDED.nome",
    [equipeId, nome]
  );

export const addParticipante = (torneioId: string, equipeId: string) =>
  pool.query("INSERT INTO participantes (torneio_id, equipe_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [torneioId, equipeId]);

export const inserirResultado = (r: ResultadoPartida) =>
  pool.query(
    `INSERT INTO resultados (partida_id, torneio_id, equipe_a_id, equipe_b_id, placar_a, placar_b, vencedor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (partida_id) DO NOTHING`,
    [r.partidaId, r.torneioId, r.equipeAId, r.equipeBId, r.placarA, r.placarB, r.vencedorId]
  );

export const inserirTitulo = (torneioId: string, campeaoId: string, formato: string) =>
  pool.query("INSERT INTO titulos (torneio_id, campeao_id, formato) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [torneioId, campeaoId, formato]);

const mapR = (r: any): ResultadoPartida => ({
  partidaId: r.partida_id, torneioId: r.torneio_id, equipeAId: r.equipe_a_id, equipeBId: r.equipe_b_id,
  placarA: r.placar_a, placarB: r.placar_b, vencedorId: r.vencedor_id,
});

export async function nomes(): Promise<Map<string, string>> {
  return new Map((await pool.query("SELECT equipe_id, nome FROM nomes_equipes")).rows.map((r) => [r.equipe_id, r.nome]));
}

export async function dadosDoTorneio(torneioId: string) {
  const [p, r] = await Promise.all([
    pool.query("SELECT equipe_id FROM participantes WHERE torneio_id = $1", [torneioId]),
    pool.query("SELECT * FROM resultados WHERE torneio_id = $1", [torneioId]),
  ]);
  return { equipes: p.rows.map((x) => x.equipe_id as string), resultados: r.rows.map(mapR) };
}

export async function dadosGerais() {
  const [r, t] = await Promise.all([
    pool.query("SELECT * FROM resultados"),
    pool.query("SELECT campeao_id, count(*)::int AS n FROM titulos GROUP BY campeao_id"),
  ]);
  const titulos = new Map<string, number>(t.rows.map((x) => [x.campeao_id, x.n]));
  const resultados = r.rows.map(mapR);
  const equipes = [...new Set([...resultados.flatMap((x) => [x.equipeAId, x.equipeBId]), ...titulos.keys()])];
  return { equipes, resultados, titulos };
}

export async function marcarProcessado(eventId: string): Promise<boolean> {
  const r = await pool.query("INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
  return (r.rowCount ?? 0) > 0;
}
export const desmarcarProcessado = (eventId: string) => pool.query("DELETE FROM eventos_processados WHERE event_id = $1", [eventId]);
