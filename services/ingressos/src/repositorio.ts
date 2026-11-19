import { Pool, PoolClient } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "./db";
import { StatusIngresso, StatusPedido } from "./estados";

export type Queryable = Pool | PoolClient;

export interface ItemPedido {
  id: string;
  pedidoId: string;
  loteId: string;
  setorNome: string | null;
  loteNome: string | null;
  quantidade: number;
  politica: string;
  precoUnitarioCentavos: number;
}

export interface Pedido {
  id: string;
  eventoId: string;
  compradorId: string;
  status: StatusPedido;
  totalCentavos: number;
  meio: string;
  /** Referência OPACA ao meio de pagamento. Nunca o número do cartão. */
  referenciaPagamento: string;
  motivo: string | null;
  /** Cópias que chegaram por evento — este serviço não consulta Eventos. */
  eventoNome: string | null;
  eventoDataHora: Date | null;
  eventoLocal: string | null;
  expiraEm: Date;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface Ingresso {
  id: string;
  pedidoId: string;
  eventoId: string;
  titularId: string;
  codigo: string;
  setorNome: string | null;
  loteNome: string | null;
  politica: string;
  precoCentavos: number;
  status: StatusIngresso;
  eventoNome: string | null;
  eventoDataHora: Date | null;
  eventoLocal: string | null;
  emitidoEm: Date;
  validadoEm: Date | null;
  validadoPor: string | null;
}

export interface LinhaHistorico {
  id: string;
  pedidoId: string;
  comando: string;
  autorId: string | null;
  dados: Record<string, unknown>;
  statusApos: string;
  executadoEm: Date;
}

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id                   UUID PRIMARY KEY,
      evento_id            UUID NOT NULL,
      comprador_id         UUID NOT NULL,
      status               TEXT NOT NULL,
      total_centavos       INT  NOT NULL DEFAULT 0,
      meio                 TEXT NOT NULL,
      referencia_pagamento TEXT NOT NULL,
      motivo               TEXT,
      evento_nome          TEXT,
      evento_data_hora     TIMESTAMPTZ,
      evento_local         TEXT,
      expira_em            TIMESTAMPTZ NOT NULL,
      criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pedidos_comprador ON pedidos (comprador_id, criado_em DESC);
    CREATE INDEX IF NOT EXISTS pedidos_evento ON pedidos (evento_id);
    -- Índice do varredor de expiração: acha rápido o que está preso.
    CREATE INDEX IF NOT EXISTS pedidos_em_andamento ON pedidos (expira_em)
      WHERE status IN ('PENDENTE','RESERVADO','AGUARDANDO_PAGAMENTO');

    CREATE TABLE IF NOT EXISTS pedido_itens (
      id                      UUID PRIMARY KEY,
      pedido_id               UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      lote_id                 UUID NOT NULL,
      setor_nome              TEXT,
      lote_nome               TEXT,
      quantidade              INT  NOT NULL CHECK (quantidade > 0),
      politica                TEXT NOT NULL,
      preco_unitario_centavos INT  NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS pedido_itens_pedido ON pedido_itens (pedido_id);

    CREATE TABLE IF NOT EXISTS ingressos (
      id               UUID PRIMARY KEY,
      pedido_id        UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      evento_id        UUID NOT NULL,
      titular_id       UUID NOT NULL,
      -- Código único do ingresso digital: é o que o QR carrega e o que a
      -- portaria lê. UNIQUE impede dois ingressos com o mesmo código.
      codigo           TEXT NOT NULL UNIQUE,
      setor_nome       TEXT,
      lote_nome        TEXT,
      politica         TEXT NOT NULL,
      preco_centavos   INT  NOT NULL DEFAULT 0,
      status           TEXT NOT NULL,
      evento_nome      TEXT,
      evento_data_hora TIMESTAMPTZ,
      evento_local     TEXT,
      emitido_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
      validado_em      TIMESTAMPTZ,
      validado_por     UUID
    );
    CREATE INDEX IF NOT EXISTS ingressos_titular ON ingressos (titular_id, emitido_em DESC);
    CREATE INDEX IF NOT EXISTS ingressos_evento ON ingressos (evento_id);

    -- HISTÓRICO DO PEDIDO (padrão Command): quem fez o quê e quando.
    CREATE TABLE IF NOT EXISTS pedido_historico (
      id           UUID PRIMARY KEY,
      pedido_id    UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      comando      TEXT NOT NULL,
      autor_id     UUID,
      dados        JSONB NOT NULL DEFAULT '{}',
      status_apos  TEXT NOT NULL,
      executado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS pedido_historico_pedido ON pedido_historico (pedido_id, executado_em);

    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
}

const mapPedido = (r: any): Pedido => ({
  id: r.id, eventoId: r.evento_id, compradorId: r.comprador_id, status: r.status,
  totalCentavos: r.total_centavos, meio: r.meio, referenciaPagamento: r.referencia_pagamento,
  motivo: r.motivo, eventoNome: r.evento_nome, eventoDataHora: r.evento_data_hora,
  eventoLocal: r.evento_local, expiraEm: r.expira_em, criadoEm: r.criado_em,
  atualizadoEm: r.atualizado_em,
});

const mapItem = (r: any): ItemPedido => ({
  id: r.id, pedidoId: r.pedido_id, loteId: r.lote_id, setorNome: r.setor_nome,
  loteNome: r.lote_nome, quantidade: r.quantidade, politica: r.politica,
  precoUnitarioCentavos: r.preco_unitario_centavos,
});

const mapIngresso = (r: any): Ingresso => ({
  id: r.id, pedidoId: r.pedido_id, eventoId: r.evento_id, titularId: r.titular_id,
  codigo: r.codigo, setorNome: r.setor_nome, loteNome: r.lote_nome, politica: r.politica,
  precoCentavos: r.preco_centavos, status: r.status, eventoNome: r.evento_nome,
  eventoDataHora: r.evento_data_hora, eventoLocal: r.evento_local,
  emitidoEm: r.emitido_em, validadoEm: r.validado_em, validadoPor: r.validado_por,
});

const mapHistorico = (r: any): LinhaHistorico => ({
  id: r.id, pedidoId: r.pedido_id, comando: r.comando, autorId: r.autor_id,
  dados: r.dados, statusApos: r.status_apos, executadoEm: r.executado_em,
});

// ---------- pedidos ----------

export interface NovoPedido {
  eventoId: string;
  compradorId: string;
  meio: string;
  referenciaPagamento: string;
  expiraEm: Date;
  itens: { loteId: string; quantidade: number; politica: string }[];
}

export async function criarPedido(q: Queryable, p: NovoPedido): Promise<Pedido> {
  const id = randomUUID();
  const r = await q.query(
    `INSERT INTO pedidos (id, evento_id, comprador_id, status, meio, referencia_pagamento, expira_em)
     VALUES ($1,$2,$3,'PENDENTE',$4,$5,$6) RETURNING *`,
    [id, p.eventoId, p.compradorId, p.meio, p.referenciaPagamento, p.expiraEm]
  );
  for (const item of p.itens) {
    await q.query(
      `INSERT INTO pedido_itens (id, pedido_id, lote_id, quantidade, politica)
       VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), id, item.loteId, item.quantidade, item.politica]
    );
  }
  return mapPedido(r.rows[0]);
}

export async function buscarPedido(q: Queryable, id: string, travar = false): Promise<Pedido | null> {
  const r = await q.query(`SELECT * FROM pedidos WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? mapPedido(r.rows[0]) : null;
}

export async function itensDoPedido(q: Queryable, pedidoId: string): Promise<ItemPedido[]> {
  const r = await q.query("SELECT * FROM pedido_itens WHERE pedido_id = $1 ORDER BY id", [pedidoId]);
  return r.rows.map(mapItem);
}

export async function atualizarStatusPedido(
  q: Queryable, id: string, status: StatusPedido, motivo: string | null = null
): Promise<void> {
  await q.query(
    "UPDATE pedidos SET status = $2, motivo = COALESCE($3, motivo), atualizado_em = now() WHERE id = $1",
    [id, status, motivo]
  );
}

/** Grava o que Eventos informou: preços, nomes legíveis e total. */
export async function aplicarReserva(
  q: Queryable,
  pedidoId: string,
  dados: {
    totalCentavos: number;
    eventoNome: string; eventoDataHora: string; eventoLocal: string;
    itens: { loteId: string; setorNome: string; loteNome: string; precoUnitarioCentavos: number }[];
  }
): Promise<void> {
  await q.query(
    `UPDATE pedidos SET total_centavos = $2, evento_nome = $3, evento_data_hora = $4,
                        evento_local = $5, atualizado_em = now()
      WHERE id = $1`,
    [pedidoId, dados.totalCentavos, dados.eventoNome, dados.eventoDataHora, dados.eventoLocal]
  );
  for (const item of dados.itens) {
    await q.query(
      `UPDATE pedido_itens SET setor_nome = $3, lote_nome = $4, preco_unitario_centavos = $5
        WHERE pedido_id = $1 AND lote_id = $2`,
      [pedidoId, item.loteId, item.setorNome, item.loteNome, item.precoUnitarioCentavos]
    );
  }
}

export async function listarPedidos(f: {
  compradorId: string | null; eventoId?: string; status?: StatusPedido; limite: number;
}): Promise<Pedido[]> {
  const r = await pool.query(
    `SELECT * FROM pedidos
      WHERE ($1::uuid IS NULL OR comprador_id = $1)
        AND ($2::uuid IS NULL OR evento_id = $2)
        AND ($3::text IS NULL OR status = $3)
      ORDER BY criado_em DESC LIMIT $4`,
    [f.compradorId, f.eventoId ?? null, f.status ?? null, f.limite]
  );
  return r.rows.map(mapPedido);
}

/**
 * Pedidos presos: em andamento e com o prazo estourado.
 *
 * PAGO fica de fora de propósito — dinheiro já entrou, então o caminho é
 * concluir a emissão, nunca expirar.
 */
export async function pedidosExpirados(q: Queryable, limite = 50): Promise<Pedido[]> {
  const r = await q.query(
    `SELECT * FROM pedidos
      WHERE status IN ('PENDENTE','RESERVADO','AGUARDANDO_PAGAMENTO')
        AND expira_em < now()
      ORDER BY expira_em
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limite]
  );
  return r.rows.map(mapPedido);
}

/** Pedidos de um evento que ainda valem — usados ao cancelar o evento. */
export async function pedidosVivosDoEvento(q: Queryable, eventoId: string): Promise<Pedido[]> {
  const r = await q.query(
    `SELECT * FROM pedidos
      WHERE evento_id = $1 AND status NOT IN ('CANCELADO','EXPIRADO','RECUSADO')
      FOR UPDATE`,
    [eventoId]
  );
  return r.rows.map(mapPedido);
}

export async function pedidosDoComprador(q: Queryable, compradorId: string): Promise<Pedido[]> {
  const r = await q.query("SELECT * FROM pedidos WHERE comprador_id = $1 FOR UPDATE", [compradorId]);
  return r.rows.map(mapPedido);
}

/**
 * Quantos ingressos o comprador já tem (ou está comprando) deste evento.
 * Base do limite por comprador, na Chain of Responsibility.
 */
export async function quantidadeJaPedida(q: Queryable, eventoId: string, compradorId: string): Promise<number> {
  const r = await q.query(
    `SELECT COALESCE(SUM(i.quantidade), 0)::int AS n
       FROM pedido_itens i
       JOIN pedidos p ON p.id = i.pedido_id
      WHERE p.evento_id = $1 AND p.comprador_id = $2
        AND p.status NOT IN ('CANCELADO','EXPIRADO','RECUSADO')`,
    [eventoId, compradorId]
  );
  return r.rows[0].n as number;
}

/** O comprador já tem um pedido rodando para este evento? */
export async function temPedidoEmAndamento(q: Queryable, eventoId: string, compradorId: string): Promise<boolean> {
  const r = await q.query(
    `SELECT 1 FROM pedidos
      WHERE evento_id = $1 AND comprador_id = $2
        AND status IN ('PENDENTE','RESERVADO','AGUARDANDO_PAGAMENTO')
      LIMIT 1`,
    [eventoId, compradorId]
  );
  return (r.rowCount ?? 0) > 0;
}

// ---------- ingressos ----------

/**
 * Código do ingresso digital: ARENA-XXXX-XXXX-XXXX.
 * Sorteado de bytes criptográficos, não sequencial — não dá para adivinhar o
 * ingresso de outra pessoa a partir do seu.
 */
export function gerarCodigo(): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem O/0 e I/1
  const bytes = randomBytes(12);
  const bloco = (i: number) => [...bytes.subarray(i * 4, i * 4 + 4)]
    .map((b) => alfabeto[b % alfabeto.length]).join("");
  return `ARENA-${bloco(0)}-${bloco(1)}-${bloco(2)}`;
}

export interface NovoIngresso {
  pedidoId: string; eventoId: string; titularId: string;
  setorNome: string | null; loteNome: string | null; politica: string; precoCentavos: number;
  eventoNome: string | null; eventoDataHora: Date | null; eventoLocal: string | null;
}

export async function emitirIngresso(q: Queryable, d: NovoIngresso): Promise<Ingresso> {
  // Colisão de código é praticamente impossível, mas se acontecer tenta de novo.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      const r = await q.query(
        `INSERT INTO ingressos
           (id, pedido_id, evento_id, titular_id, codigo, setor_nome, lote_nome, politica,
            preco_centavos, status, evento_nome, evento_data_hora, evento_local)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'EMITIDO',$10,$11,$12) RETURNING *`,
        [randomUUID(), d.pedidoId, d.eventoId, d.titularId, gerarCodigo(), d.setorNome,
         d.loteNome, d.politica, d.precoCentavos, d.eventoNome, d.eventoDataHora, d.eventoLocal]
      );
      return mapIngresso(r.rows[0]);
    } catch (e: any) {
      if (e?.code !== "23505") throw e;
    }
  }
  throw new Error("não foi possível gerar um código único para o ingresso");
}

export async function ingressosDoPedido(q: Queryable, pedidoId: string): Promise<Ingresso[]> {
  const r = await q.query("SELECT * FROM ingressos WHERE pedido_id = $1 ORDER BY emitido_em", [pedidoId]);
  return r.rows.map(mapIngresso);
}

export async function contarIngressosDoPedido(q: Queryable, pedidoId: string): Promise<number> {
  const r = await q.query("SELECT count(*)::int AS n FROM ingressos WHERE pedido_id = $1", [pedidoId]);
  return r.rows[0].n as number;
}

export async function buscarIngresso(q: Queryable, id: string, travar = false): Promise<Ingresso | null> {
  const r = await q.query(`SELECT * FROM ingressos WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? mapIngresso(r.rows[0]) : null;
}

export async function buscarIngressoPorCodigo(q: Queryable, codigo: string, travar = false): Promise<Ingresso | null> {
  const r = await q.query(
    `SELECT * FROM ingressos WHERE codigo = $1${travar ? " FOR UPDATE" : ""}`,
    [codigo.trim().toUpperCase()]
  );
  return r.rows[0] ? mapIngresso(r.rows[0]) : null;
}

export async function atualizarStatusIngresso(
  q: Queryable, id: string, status: StatusIngresso
): Promise<void> {
  await q.query("UPDATE ingressos SET status = $2 WHERE id = $1", [id, status]);
}

/**
 * Marca o ingresso como utilizado SOMENTE se ainda estava EMITIDO.
 *
 * A condição vai dentro do UPDATE: duas leituras do mesmo QR na portaria não
 * conseguem as duas entrar, mesmo chegando ao mesmo tempo.
 */
export async function registrarEntrada(q: Queryable, id: string, validadoPor: string): Promise<boolean> {
  const r = await q.query(
    `UPDATE ingressos SET status = 'UTILIZADO', validado_em = now(), validado_por = $2
      WHERE id = $1 AND status = 'EMITIDO'`,
    [id, validadoPor]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listarIngressos(f: {
  titularId: string | null; eventoId?: string; status?: StatusIngresso; limite: number;
}): Promise<Ingresso[]> {
  const r = await pool.query(
    `SELECT * FROM ingressos
      WHERE ($1::uuid IS NULL OR titular_id = $1)
        AND ($2::uuid IS NULL OR evento_id = $2)
        AND ($3::text IS NULL OR status = $3)
      ORDER BY emitido_em DESC LIMIT $4`,
    [f.titularId, f.eventoId ?? null, f.status ?? null, f.limite]
  );
  return r.rows.map(mapIngresso);
}

/** Ingressos ainda válidos de um evento, para invalidar em cascata. */
export async function ingressosVivosDoEvento(q: Queryable, eventoId: string): Promise<Ingresso[]> {
  const r = await q.query(
    "SELECT * FROM ingressos WHERE evento_id = $1 AND status IN ('EMITIDO','UTILIZADO') FOR UPDATE",
    [eventoId]
  );
  return r.rows.map(mapIngresso);
}

// ---------- histórico (Command) ----------

export async function registrarHistorico(
  q: Queryable, pedidoId: string, comando: string, autorId: string | null,
  dados: Record<string, unknown>, statusApos: string
): Promise<void> {
  await q.query(
    `INSERT INTO pedido_historico (id, pedido_id, comando, autor_id, dados, status_apos)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), pedidoId, comando, autorId, JSON.stringify(dados), statusApos]
  );
}

export async function historicoDoPedido(q: Queryable, pedidoId: string): Promise<LinhaHistorico[]> {
  const r = await q.query(
    "SELECT * FROM pedido_historico WHERE pedido_id = $1 ORDER BY executado_em, id", [pedidoId]
  );
  return r.rows.map(mapHistorico);
}

// ---------- idempotência ----------

export async function marcarProcessado(eventId: string): Promise<boolean> {
  const r = await pool.query("INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
  return (r.rowCount ?? 0) > 0;
}

export async function desmarcarProcessado(eventId: string): Promise<void> {
  await pool.query("DELETE FROM eventos_processados WHERE event_id = $1", [eventId]);
}
