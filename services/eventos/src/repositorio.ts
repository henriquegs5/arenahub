import { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { StatusEvento } from "./estados";
import { PoliticaPreco } from "./precos";
import { EventoComposto, Lote, Setor } from "./estrutura";

export type Queryable = Pool | PoolClient;

export interface Evento {
  id: string;
  nome: string;
  descricao: string | null;
  dataHora: Date;
  local: string;
  status: StatusEvento;
  organizadorId: string;
  motivoCancelamento: string | null;
  criadoEm: Date;
}

export interface LinhaSetor {
  id: string; eventoId: string; nome: string; descricao: string | null;
}

/**
 * Migrações na subida do serviço, com CREATE TABLE IF NOT EXISTS e
 * ADD COLUMN IF NOT EXISTS, de forma que o serviço suba tanto num banco vazio
 * quanto num já existente.
 *
 * NÃO existe chave estrangeira para usuário: `organizador_id` é apenas o ID de
 * uma entidade de outro serviço (Database per Service). As FKs abaixo são
 * internas ao próprio serviço de eventos, onde são legítimas.
 */
export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eventos (
      id             UUID PRIMARY KEY,
      nome           TEXT NOT NULL,
      descricao      TEXT,
      data_hora      TIMESTAMPTZ NOT NULL,
      local          TEXT NOT NULL,
      status         TEXT NOT NULL,
      organizador_id UUID NOT NULL,
      motivo_cancelamento TEXT,
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS setores (
      id        UUID PRIMARY KEY,
      evento_id UUID NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
      nome      TEXT NOT NULL,
      descricao TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS setores_evento ON setores (evento_id);

    CREATE TABLE IF NOT EXISTS lotes (
      id                  UUID PRIMARY KEY,
      setor_id            UUID NOT NULL REFERENCES setores(id) ON DELETE CASCADE,
      nome                TEXT NOT NULL,
      preco_centavos      INT  NOT NULL CHECK (preco_centavos >= 0),
      desconto_percentual INT  NOT NULL DEFAULT 0 CHECK (desconto_percentual BETWEEN 0 AND 100),
      politica_padrao     TEXT NOT NULL DEFAULT 'INTEIRA',
      capacidade          INT  NOT NULL CHECK (capacidade >= 0),
      reservados          INT  NOT NULL DEFAULT 0 CHECK (reservados >= 0),
      inicio_vendas       TIMESTAMPTZ,
      fim_vendas          TIMESTAMPTZ,
      ativo               BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- Invariante mais importante do serviço: nunca sai mais do que cabe.
      CONSTRAINT lotes_nao_estoura CHECK (reservados <= capacidade)
    );
    CREATE INDEX IF NOT EXISTS lotes_setor ON lotes (setor_id);

    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);
}

const mapEvento = (r: any): Evento => ({
  id: r.id, nome: r.nome, descricao: r.descricao, dataHora: r.data_hora, local: r.local,
  status: r.status, organizadorId: r.organizador_id,
  motivoCancelamento: r.motivo_cancelamento, criadoEm: r.criado_em,
});

const mapSetor = (r: any): LinhaSetor => ({
  id: r.id, eventoId: r.evento_id, nome: r.nome, descricao: r.descricao,
});

const mapLote = (r: any): Lote => new Lote(
  r.id, r.setor_id, r.nome, r.preco_centavos, r.desconto_percentual,
  r.politica_padrao as PoliticaPreco, r.capacidade, r.reservados,
  r.inicio_vendas, r.fim_vendas, r.ativo
);

// ---------- eventos ----------

export interface DadosEvento {
  nome: string; descricao: string | null; dataHora: Date; local: string;
}

export async function criarEvento(d: DadosEvento, organizadorId: string): Promise<Evento> {
  const id = randomUUID();
  const r = await pool.query(
    `INSERT INTO eventos (id, nome, descricao, data_hora, local, status, organizador_id)
     VALUES ($1,$2,$3,$4,$5,'RASCUNHO',$6) RETURNING *`,
    [id, d.nome, d.descricao, d.dataHora, d.local, organizadorId]
  );
  return mapEvento(r.rows[0]);
}

export async function buscarEvento(id: string, q: Queryable = pool, travar = false): Promise<Evento | null> {
  const r = await q.query(`SELECT * FROM eventos WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? mapEvento(r.rows[0]) : null;
}

/**
 * Catálogo. Quem não é ADM nem organizador só vê o que já foi publicado —
 * rascunho dos outros não aparece. A regra é aplicada no SQL, no backend.
 */
export async function listarEventos(f: {
  status?: StatusEvento; busca?: string; organizadorId?: string; verTudo: boolean; soDoOrganizador?: string;
}): Promise<Evento[]> {
  const r = await pool.query(
    `SELECT * FROM eventos
      WHERE ($1::boolean OR status <> 'RASCUNHO' OR organizador_id = $2::uuid)
        AND ($3::text IS NULL OR status = $3)
        AND ($4::text IS NULL OR nome ILIKE '%' || $4 || '%' OR local ILIKE '%' || $4 || '%')
        AND ($5::uuid IS NULL OR organizador_id = $5)
      ORDER BY data_hora ASC`,
    [f.verTudo, f.organizadorId ?? null, f.status ?? null, f.busca ?? null, f.soDoOrganizador ?? null]
  );
  return r.rows.map(mapEvento);
}

export async function atualizarEvento(q: Queryable, id: string, d: Partial<DadosEvento>): Promise<void> {
  await q.query(
    `UPDATE eventos SET
       nome      = COALESCE($2, nome),
       descricao = COALESCE($3, descricao),
       data_hora = COALESCE($4, data_hora),
       local     = COALESCE($5, local)
     WHERE id = $1`,
    [id, d.nome ?? null, d.descricao ?? null, d.dataHora ?? null, d.local ?? null]
  );
}

export async function atualizarStatus(
  q: Queryable, id: string, status: StatusEvento, motivo: string | null = null
): Promise<void> {
  await q.query(
    "UPDATE eventos SET status = $2, motivo_cancelamento = COALESCE($3, motivo_cancelamento) WHERE id = $1",
    [id, status, motivo]
  );
}

export async function removerEvento(q: Queryable, id: string): Promise<boolean> {
  const r = await q.query("DELETE FROM eventos WHERE id = $1", [id]);
  return (r.rowCount ?? 0) > 0;
}

/** Eventos de um organizador que ainda não terminaram (compensação do lote 5). */
export async function ativosDoOrganizador(q: Queryable, organizadorId: string): Promise<Evento[]> {
  const r = await q.query(
    "SELECT * FROM eventos WHERE organizador_id = $1 AND status NOT IN ('REALIZADO','CANCELADO') FOR UPDATE",
    [organizadorId]
  );
  return r.rows.map(mapEvento);
}

// ---------- setores ----------

export async function criarSetor(
  q: Queryable, eventoId: string, nome: string, descricao: string | null
): Promise<LinhaSetor> {
  const id = randomUUID();
  await q.query("INSERT INTO setores (id, evento_id, nome, descricao) VALUES ($1,$2,$3,$4)",
    [id, eventoId, nome, descricao]);
  return { id, eventoId, nome, descricao };
}

export async function buscarSetor(q: Queryable, id: string): Promise<LinhaSetor | null> {
  const r = await q.query("SELECT * FROM setores WHERE id = $1", [id]);
  return r.rows[0] ? mapSetor(r.rows[0]) : null;
}

export async function atualizarSetor(
  q: Queryable, id: string, nome?: string, descricao?: string | null
): Promise<void> {
  await q.query(
    "UPDATE setores SET nome = COALESCE($2, nome), descricao = COALESCE($3, descricao) WHERE id = $1",
    [id, nome ?? null, descricao ?? null]
  );
}

export async function removerSetor(q: Queryable, id: string): Promise<void> {
  await q.query("DELETE FROM setores WHERE id = $1", [id]);
}

export async function listarSetores(q: Queryable, eventoId: string): Promise<LinhaSetor[]> {
  const r = await q.query("SELECT * FROM setores WHERE evento_id = $1 ORDER BY criado_em", [eventoId]);
  return r.rows.map(mapSetor);
}

// ---------- lotes ----------

export interface DadosLote {
  nome: string;
  precoCentavos: number;
  descontoPercentual: number;
  politicaPadrao: PoliticaPreco;
  capacidade: number;
  inicioVendas: Date | null;
  fimVendas: Date | null;
  ativo: boolean;
}

export async function criarLote(q: Queryable, setorId: string, d: DadosLote): Promise<Lote> {
  const id = randomUUID();
  const r = await q.query(
    `INSERT INTO lotes (id, setor_id, nome, preco_centavos, desconto_percentual, politica_padrao,
                        capacidade, inicio_vendas, fim_vendas, ativo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [id, setorId, d.nome, d.precoCentavos, d.descontoPercentual, d.politicaPadrao,
     d.capacidade, d.inicioVendas, d.fimVendas, d.ativo]
  );
  return mapLote(r.rows[0]);
}

export async function buscarLote(q: Queryable, id: string, travar = false): Promise<Lote | null> {
  const r = await q.query(`SELECT * FROM lotes WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? mapLote(r.rows[0]) : null;
}

export async function atualizarLote(q: Queryable, id: string, d: Partial<DadosLote>): Promise<void> {
  await q.query(
    `UPDATE lotes SET
       nome                = COALESCE($2, nome),
       preco_centavos      = COALESCE($3, preco_centavos),
       desconto_percentual = COALESCE($4, desconto_percentual),
       politica_padrao     = COALESCE($5, politica_padrao),
       capacidade          = COALESCE($6, capacidade),
       inicio_vendas       = COALESCE($7, inicio_vendas),
       fim_vendas          = COALESCE($8, fim_vendas),
       ativo               = COALESCE($9, ativo)
     WHERE id = $1`,
    [id, d.nome ?? null, d.precoCentavos ?? null, d.descontoPercentual ?? null,
     d.politicaPadrao ?? null, d.capacidade ?? null, d.inicioVendas ?? null,
     d.fimVendas ?? null, d.ativo ?? null]
  );
}

export async function removerLote(q: Queryable, id: string): Promise<void> {
  await q.query("DELETE FROM lotes WHERE id = $1", [id]);
}

export async function listarLotesDoEvento(q: Queryable, eventoId: string): Promise<Lote[]> {
  const r = await q.query(
    `SELECT l.* FROM lotes l
       JOIN setores s ON s.id = l.setor_id
      WHERE s.evento_id = $1
      ORDER BY l.criado_em`,
    [eventoId]
  );
  return r.rows.map(mapLote);
}

/** Monta a árvore Composite completa do evento. */
export async function carregarEstrutura(q: Queryable, evento: Evento): Promise<EventoComposto> {
  const [setores, lotes] = await Promise.all([
    listarSetores(q, evento.id),
    listarLotesDoEvento(q, evento.id),
  ]);
  return EventoComposto.montar(evento, setores, lotes);
}

/** O setor pertence mesmo a este evento? Evita mexer no setor de outro. */
export async function setorDoEvento(q: Queryable, setorId: string, eventoId: string): Promise<LinhaSetor | null> {
  const s = await buscarSetor(q, setorId);
  return s && s.eventoId === eventoId ? s : null;
}

export async function eventoDoLote(q: Queryable, loteId: string): Promise<string | null> {
  const r = await q.query(
    "SELECT s.evento_id FROM lotes l JOIN setores s ON s.id = l.setor_id WHERE l.id = $1", [loteId]
  );
  return r.rows[0]?.evento_id ?? null;
}

// ---------- reserva e liberação de lugares ----------

/**
 * Reserva `quantidade` lugares num lote, de forma ATÔMICA.
 *
 * A condição `reservados + $2 <= capacidade` vai dentro do próprio UPDATE: duas
 * compras simultâneas do último lugar não conseguem as duas passar, porque o
 * banco serializa a linha. Devolve false quando não havia lugar — o chamador
 * transforma isso em `reserva.recusada` e a Saga compensa.
 */
export async function reservarLugares(q: Queryable, loteId: string, quantidade: number): Promise<boolean> {
  const r = await q.query(
    `UPDATE lotes SET reservados = reservados + $2
      WHERE id = $1 AND reservados + $2 <= capacidade`,
    [loteId, quantidade]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Libera lugares reservados (COMPENSAÇÃO da Saga).
 * Nunca deixa `reservados` ficar negativo, mesmo se a compensação repetir.
 */
export async function liberarLugares(q: Queryable, loteId: string, quantidade: number): Promise<void> {
  await q.query(
    "UPDATE lotes SET reservados = GREATEST(0, reservados - $2) WHERE id = $1",
    [loteId, quantidade]
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

/** Reexporta para quem só precisa do tipo da árvore. */
export type { Setor };
