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

  // Cada aviso pertence a um destinatário; a listagem filtra por ele.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notificacoes_usuario
      ON notificacoes (usuario_id, criado_em DESC);`);
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
}

const map = (x: any): LinhaNotificacao => ({
  id: x.id, tipo: x.tipo, titulo: x.titulo, mensagem: x.mensagem,
  usuarioId: x.usuario_id, eventoId: x.evento_id, pedidoId: x.pedido_id,
  ingressoId: x.ingresso_id, criadoEm: x.criado_em,
});

/**
 * Lista os avisos de UM destinatário. `usuarioId` nulo só é aceito para o ADM,
 * que vê todos (a decisão de quem pode ver o quê está em routes.ts).
 */
export async function listar(f: { usuarioId: string | null; limite: number }): Promise<LinhaNotificacao[]> {
  const r = await pool.query(
    `SELECT id, tipo, titulo, mensagem, usuario_id, evento_id, pedido_id, ingresso_id, criado_em
       FROM notificacoes
      WHERE ($1::uuid IS NULL OR usuario_id = $1)
      ORDER BY criado_em DESC LIMIT $2`,
    [f.usuarioId, f.limite]
  );
  return r.rows.map(map);
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
