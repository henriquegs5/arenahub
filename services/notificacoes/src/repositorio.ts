import { pool } from "./db";

/**
 * Migrações na subida do serviço. Rodam tanto num banco vazio quanto num já
 * existente: as colunas do domínio antigo (campeonatos) são renomeadas para as
 * do novo domínio (ingressos) apenas se ainda existirem.
 */
export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notificacoes (
      id         UUID PRIMARY KEY,
      tipo       TEXT NOT NULL,
      titulo     TEXT NOT NULL,
      mensagem   TEXT NOT NULL,
      usuario_id UUID,
      dados      JSONB NOT NULL DEFAULT '{}',
      criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS eventos_processados (
      event_id      UUID PRIMARY KEY,
      processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  // Migração de domínio: torneio/partida deixam de existir; evento/pedido entram.
  await pool.query(`
    ALTER TABLE notificacoes RENAME COLUMN torneio_id TO evento_id;`).catch(() => undefined);
  await pool.query(`
    ALTER TABLE notificacoes RENAME COLUMN partida_id TO pedido_id;`).catch(() => undefined);

  await pool.query(`
    ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS evento_id  UUID;
    ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS pedido_id  UUID;
    ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS ingresso_id UUID;`);

  /**
   * CONTROLE DE LEITURA NO BACKEND.
   *
   * Antes isto vivia no `localStorage` do navegador, o que estava errado: a
   * marcação sumia ao trocar de máquina ou limpar o navegador, e o contador de
   * não lidas discordava entre abas. `lida_em` nulo significa não lida.
   */
  await pool.query(`ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS lida_em TIMESTAMPTZ;`);

  // Cada aviso pertence a um destinatário; a listagem filtra por ele.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notificacoes_usuario
      ON notificacoes (usuario_id, criado_em DESC);`);

  // Índice do contador de não lidas, consultado a cada ciclo da interface.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notificacoes_nao_lidas
      ON notificacoes (usuario_id) WHERE lida_em IS NULL;`);
}

export interface LinhaNotificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  usuarioId: string | null;
  eventoId: string | null;
  pedidoId: string | null;
  ingressoId: string | null;
  criadoEm: string;
  lidaEm: string | null;
  lida: boolean;
}

const map = (x: any): LinhaNotificacao => ({
  id: x.id, tipo: x.tipo, titulo: x.titulo, mensagem: x.mensagem,
  usuarioId: x.usuario_id, eventoId: x.evento_id, pedidoId: x.pedido_id,
  ingressoId: x.ingresso_id, criadoEm: x.criado_em,
  lidaEm: x.lida_em, lida: x.lida_em !== null,
});

const CAMPOS = `id, tipo, titulo, mensagem, usuario_id, evento_id, pedido_id,
                ingresso_id, criado_em, lida_em`;

/**
 * Lista os avisos de UM destinatário. `usuarioId` nulo só é aceito para o ADM,
 * que vê todos (a decisão de quem pode ver o quê está em routes.ts).
 */
export async function listar(f: {
  usuarioId: string | null;
  apenasNaoLidas?: boolean;
  limite: number;
}): Promise<LinhaNotificacao[]> {
  const r = await pool.query(
    `SELECT ${CAMPOS}
       FROM notificacoes
      WHERE ($1::uuid IS NULL OR usuario_id = $1)
        AND ($2::boolean IS NOT TRUE OR lida_em IS NULL)
      ORDER BY criado_em DESC LIMIT $3`,
    [f.usuarioId, f.apenasNaoLidas ?? false, f.limite]
  );
  return r.rows.map(map);
}

export async function buscar(id: string): Promise<LinhaNotificacao | null> {
  const r = await pool.query(`SELECT ${CAMPOS} FROM notificacoes WHERE id = $1`, [id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

/** Quantos avisos não lidos o usuário tem. Nulo = todos (ADM). */
export async function contarNaoLidas(usuarioId: string | null): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM notificacoes
      WHERE ($1::uuid IS NULL OR usuario_id = $1) AND lida_em IS NULL`,
    [usuarioId]
  );
  return r.rows[0].n as number;
}

/**
 * Marca um aviso como lido. Idempotente: marcar de novo não muda o instante
 * original, então a data de leitura continua sendo a primeira.
 */
export async function marcarLida(id: string): Promise<boolean> {
  const r = await pool.query(
    "UPDATE notificacoes SET lida_em = now() WHERE id = $1 AND lida_em IS NULL", [id]
  );
  return (r.rowCount ?? 0) > 0;
}

export async function marcarNaoLida(id: string): Promise<boolean> {
  const r = await pool.query(
    "UPDATE notificacoes SET lida_em = NULL WHERE id = $1 AND lida_em IS NOT NULL", [id]
  );
  return (r.rowCount ?? 0) > 0;
}

/** Marca como lidos todos os avisos do usuário. Devolve quantos mudaram. */
export async function marcarTodasLidas(usuarioId: string): Promise<number> {
  const r = await pool.query(
    "UPDATE notificacoes SET lida_em = now() WHERE usuario_id = $1 AND lida_em IS NULL",
    [usuarioId]
  );
  return r.rowCount ?? 0;
}

export async function remover(id: string): Promise<boolean> {
  const r = await pool.query("DELETE FROM notificacoes WHERE id = $1", [id]);
  return (r.rowCount ?? 0) > 0;
}

/** Limpeza em massa: descarta os avisos já lidos do usuário. */
export async function removerLidas(usuarioId: string): Promise<number> {
  const r = await pool.query(
    "DELETE FROM notificacoes WHERE usuario_id = $1 AND lida_em IS NOT NULL", [usuarioId]
  );
  return r.rowCount ?? 0;
}

/** Remove os avisos de um usuário excluído (compensação de `usuario.removido`). */
export async function removerDoUsuario(usuarioId: string): Promise<number> {
  const r = await pool.query("DELETE FROM notificacoes WHERE usuario_id = $1", [usuarioId]);
  return r.rowCount ?? 0;
}

export async function marcarProcessado(eventId: string): Promise<boolean> {
  const r = await pool.query("INSERT INTO eventos_processados (event_id) VALUES ($1) ON CONFLICT DO NOTHING", [eventId]);
  return (r.rowCount ?? 0) > 0;
}

export const desmarcarProcessado = (eventId: string) =>
  pool.query("DELETE FROM eventos_processados WHERE event_id = $1", [eventId]);
