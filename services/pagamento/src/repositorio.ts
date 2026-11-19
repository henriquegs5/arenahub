import { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { MeioPagamento } from "./meios";

export type Queryable = Pool | PoolClient;

export type StatusTransacao = "APROVADO" | "RECUSADO" | "ESTORNADO";

export interface Transacao {
  id: string;
  pedidoId: string;
  compradorId: string;
  valorCentavos: number;
  meio: MeioPagamento;
  /** Referência OPACA ao meio de pagamento (token). Nunca o número do cartão. */
  referenciaPagamento: string;
  status: StatusTransacao;
  identificadorExterno: string | null;
  autorizacao: string | null;
  motivo: string | null;
  criadoEm: Date;
  estornadoEm: Date | null;
}

/**
 * Migrações na subida do serviço.
 *
 * DADO SENSÍVEL: não existe coluna para número de cartão, CVV ou validade, e
 * isso é deliberado. O serviço guarda apenas `referencia_pagamento`, um token
 * opaco do meio de pagamento. Ver README, "Pagamento seguro".
 */
export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transacoes (
      id                    UUID PRIMARY KEY,
      -- Uma transação por pedido: a chave única é a própria defesa contra
      -- cobrar duas vezes se o evento da Saga for reentregue.
      pedido_id             UUID NOT NULL UNIQUE,
      comprador_id          UUID NOT NULL,
      valor_centavos        INT  NOT NULL CHECK (valor_centavos >= 0),
      meio                  TEXT NOT NULL,
      referencia_pagamento  TEXT NOT NULL,
      status                TEXT NOT NULL,
      identificador_externo TEXT,
      autorizacao           TEXT,
      motivo                TEXT,
      criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
      estornado_em          TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS transacoes_comprador ON transacoes (comprador_id, criado_em DESC);

    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
}

const map = (r: any): Transacao => ({
  id: r.id, pedidoId: r.pedido_id, compradorId: r.comprador_id,
  valorCentavos: r.valor_centavos, meio: r.meio,
  referenciaPagamento: r.referencia_pagamento, status: r.status,
  identificadorExterno: r.identificador_externo, autorizacao: r.autorizacao,
  motivo: r.motivo, criadoEm: r.criado_em, estornadoEm: r.estornado_em,
});

export async function buscarPorPedido(q: Queryable, pedidoId: string, travar = false): Promise<Transacao | null> {
  const r = await q.query(`SELECT * FROM transacoes WHERE pedido_id = $1${travar ? " FOR UPDATE" : ""}`, [pedidoId]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

export async function buscarPorId(q: Queryable, id: string): Promise<Transacao | null> {
  const r = await q.query("SELECT * FROM transacoes WHERE id = $1", [id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

export interface NovaTransacao {
  pedidoId: string;
  compradorId: string;
  valorCentavos: number;
  meio: MeioPagamento;
  referenciaPagamento: string;
  status: StatusTransacao;
  identificadorExterno: string | null;
  autorizacao: string | null;
  motivo: string | null;
}

export async function registrar(q: Queryable, t: NovaTransacao): Promise<Transacao> {
  const id = randomUUID();
  const r = await q.query(
    `INSERT INTO transacoes
       (id, pedido_id, comprador_id, valor_centavos, meio, referencia_pagamento,
        status, identificador_externo, autorizacao, motivo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [id, t.pedidoId, t.compradorId, t.valorCentavos, t.meio, t.referenciaPagamento,
     t.status, t.identificadorExterno, t.autorizacao, t.motivo]
  );
  return map(r.rows[0]);
}

export async function marcarEstornada(q: Queryable, id: string, motivo: string): Promise<void> {
  await q.query(
    "UPDATE transacoes SET status = 'ESTORNADO', estornado_em = now(), motivo = $2 WHERE id = $1",
    [id, motivo]
  );
}

/** Consulta do comprador (ou de todos, para o ADM). */
export async function listar(f: { compradorId: string | null; limite: number }): Promise<Transacao[]> {
  const r = await pool.query(
    `SELECT * FROM transacoes
      WHERE ($1::uuid IS NULL OR comprador_id = $1)
      ORDER BY criado_em DESC LIMIT $2`,
    [f.compradorId, f.limite]
  );
  return r.rows.map(map);
}

/** Transações de um usuário removido, para a compensação do lote 5. */
export async function aprovadasDoComprador(q: Queryable, compradorId: string): Promise<Transacao[]> {
  const r = await q.query(
    "SELECT * FROM transacoes WHERE comprador_id = $1 AND status = 'APROVADO' FOR UPDATE",
    [compradorId]
  );
  return r.rows.map(map);
}

// ---------- idempotência ----------

export async function marcarProcessado(eventId: string): Promise<boolean> {
  const r = await pool.query("INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
  return (r.rowCount ?? 0) > 0;
}

export async function desmarcarProcessado(eventId: string): Promise<void> {
  await pool.query("DELETE FROM eventos_processados WHERE event_id = $1", [eventId]);
}
