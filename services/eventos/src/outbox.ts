import { PoolClient } from "pg";
import { pool } from "./db";
import { EventEnvelope, montarEnvelope, publicarEnvelope } from "./messaging";

/**
 * TRANSACTIONAL OUTBOX (padrão arquitetural).
 *
 * Regra do projeto: um evento só pode ser publicado DEPOIS do commit do fato que o
 * originou. Publicar direto após o commit, porém, perde o evento se o broker estiver
 * fora do ar exatamente nesse instante — era a causa de inscrições que ficavam
 * PENDENTE para sempre.
 *
 * Aqui o evento é gravado na MESMA transação do fato (tabela `eventos_saida`) e um
 * relay o entrega ao broker depois, repetindo até conseguir. Entrega ao menos uma vez;
 * os consumidores já são idempotentes por `eventId`.
 *
 * Arquivo duplicado de propósito em cada serviço que publica eventos.
 */

export async function migrateOutbox(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eventos_saida (
      id            BIGSERIAL PRIMARY KEY,
      event_id      UUID NOT NULL UNIQUE,
      tipo          TEXT NOT NULL,
      versao        INT  NOT NULL,
      correlation_id TEXT NOT NULL,
      envelope      JSONB NOT NULL,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
      publicado_em  TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS eventos_saida_pendentes
      ON eventos_saida (id) WHERE publicado_em IS NULL;`);
}

/** Evento a publicar, devolvido por um bloco transacional. */
export interface EventoSaida {
  nome: string;
  payload: unknown;
  correlationId: string;
  versao?: number;
}

async function gravar(c: PoolClient, ev: EventoSaida): Promise<void> {
  const envelope = montarEnvelope(ev.nome, ev.versao ?? 1, ev.payload, ev.correlationId);
  await c.query(
    "INSERT INTO eventos_saida (event_id, tipo, versao, correlation_id, envelope) VALUES ($1,$2,$3,$4,$5)",
    [envelope.eventId, envelope.type, envelope.version, envelope.correlationId, JSON.stringify(envelope)]
  );
}

/** Resultado de um bloco transacional: o que devolver ao chamador e o que publicar. */
export interface Saida<T> {
  valor: T;
  eventos: EventoSaida[];
}

/**
 * Executa `fn` em transação. Os eventos que ela devolver são gravados na outbox
 * dentro da mesma transação e entregues ao broker logo após o commit.
 */
export async function transacaoCom<T>(fn: (c: PoolClient) => Promise<Saida<T>>): Promise<T> {
  const client = await pool.connect();
  let resultado: T;
  try {
    await client.query("BEGIN");
    const { valor, eventos } = await fn(client);
    for (const ev of eventos) await gravar(client, ev);
    await client.query("COMMIT");
    resultado = valor;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  void despachar();
  return resultado;
}

/** Atalho para quando só interessam os eventos produzidos. */
export function transacao(fn: (c: PoolClient) => Promise<EventoSaida[]>): Promise<void> {
  return transacaoCom(async (c) => ({ valor: undefined as void, eventos: await fn(c) }));
}

let despachando = false;

/** Entrega ao broker os eventos ainda não publicados. Devolve quantos saíram. */
export async function despachar(limite = 100): Promise<number> {
  if (despachando) return 0;
  despachando = true;
  let n = 0;
  try {
    const r = await pool.query(
      "SELECT id, envelope FROM eventos_saida WHERE publicado_em IS NULL ORDER BY id LIMIT $1",
      [limite]
    );
    for (const linha of r.rows) {
      const envelope = linha.envelope as EventEnvelope;
      if (!publicarEnvelope(envelope)) break; // broker fora do ar: tenta de novo no próximo ciclo
      await pool.query("UPDATE eventos_saida SET publicado_em = now() WHERE id = $1", [linha.id]);
      n++;
    }
  } catch (e) {
    console.error("[outbox] falha ao despachar eventos", e);
  } finally {
    despachando = false;
  }
  return n;
}

/** Quantos eventos ainda não saíram (exposto em /health para a demonstração). */
export async function pendentes(): Promise<number> {
  const r = await pool.query("SELECT count(*)::int AS n FROM eventos_saida WHERE publicado_em IS NULL");
  return r.rows[0].n as number;
}

export function iniciarRelay(ms = Number(process.env.OUTBOX_INTERVALO_MS ?? 1000)): NodeJS.Timeout {
  return setInterval(() => void despachar(), ms);
}
