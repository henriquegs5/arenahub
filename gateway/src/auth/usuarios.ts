import { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../db";
import { ADMIN_EMAIL, ADMIN_NOME, ADMIN_SENHA } from "../config";

/**
 * Perfis da plataforma de ingressos:
 *  - ADM          acesso completo a tudo;
 *  - ORGANIZADOR  cria e gerencia os próprios eventos e valida ingressos na entrada;
 *  - PARTICIPANTE compra ingressos, vê e cancela os próprios pedidos.
 */
export type Papel = "PARTICIPANTE" | "ORGANIZADOR" | "ADM";
export const PAPEIS: Papel[] = ["PARTICIPANTE", "ORGANIZADOR", "ADM"];
/** O cadastro público nunca cria administrador. */
export const PAPEIS_PUBLICOS: Papel[] = ["PARTICIPANTE", "ORGANIZADOR"];
export type Queryable = Pool | PoolClient;

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  senhaHash: string;
}

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id          UUID PRIMARY KEY,
      nome        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      papel       TEXT NOT NULL,
      senha_hash  TEXT NOT NULL,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    );`);

  // Migração de domínio: o antigo JOGADOR (campeonatos) vira PARTICIPANTE (ingressos).
  // A restrição é solta antes e recriada depois, para a troca valer num banco já existente.
  await pool.query("ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_check");
  await pool.query("UPDATE usuarios SET papel = 'PARTICIPANTE' WHERE papel = 'JOGADOR'");
  await pool.query(`
    ALTER TABLE usuarios ADD CONSTRAINT usuarios_papel_check
      CHECK (papel IN ('PARTICIPANTE','ORGANIZADOR','ADM'))`);
}

const map = (r: any): Usuario => ({
  id: r.id, nome: r.nome, email: r.email, papel: r.papel, senhaHash: r.senha_hash,
});

export async function criar(
  q: Queryable, nome: string, email: string, papel: Papel, senhaHash: string
): Promise<Usuario> {
  const id = randomUUID();
  await q.query(
    "INSERT INTO usuarios (id, nome, email, papel, senha_hash) VALUES ($1,$2,$3,$4,$5)",
    [id, nome, email, papel, senhaHash]
  );
  return { id, nome, email, papel, senhaHash };
}

export async function porEmail(email: string, q: Queryable = pool): Promise<Usuario | null> {
  const r = await q.query("SELECT * FROM usuarios WHERE email = $1", [email]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

export async function porId(id: string, q: Queryable = pool, travar = false): Promise<Usuario | null> {
  const r = await q.query(`SELECT * FROM usuarios WHERE id = $1${travar ? " FOR UPDATE" : ""}`, [id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

export async function atualizar(
  q: Queryable, id: string, campos: { nome?: string; senhaHash?: string; papel?: Papel }
): Promise<void> {
  await q.query(
    `UPDATE usuarios
        SET nome = COALESCE($2, nome),
            senha_hash = COALESCE($3, senha_hash),
            papel = COALESCE($4, papel)
      WHERE id = $1`,
    [id, campos.nome ?? null, campos.senhaHash ?? null, campos.papel ?? null]
  );
}

export async function remover(q: Queryable, id: string): Promise<boolean> {
  const r = await q.query("DELETE FROM usuarios WHERE id = $1", [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function contarAdms(q: Queryable = pool): Promise<number> {
  const r = await q.query("SELECT count(*)::int AS n FROM usuarios WHERE papel = 'ADM'");
  return r.rows[0].n as number;
}

/**
 * Catálogo de nomes para a interface: apenas id e nome.
 * Papel e e-mail ficam restritos ao próprio usuário e ao administrador.
 */
export async function listarNomes(ids?: string[]): Promise<{ id: string; nome: string }[]> {
  const r = ids?.length
    ? await pool.query("SELECT id, nome FROM usuarios WHERE id = ANY($1::uuid[]) ORDER BY nome", [ids])
    : await pool.query("SELECT id, nome FROM usuarios ORDER BY nome");
  return r.rows;
}

/** Listagem completa — só para o administrador. */
export async function listarCompleto(): Promise<{ id: string; nome: string; email: string; papel: Papel; criadoEm: string }[]> {
  const r = await pool.query("SELECT id, nome, email, papel, criado_em FROM usuarios ORDER BY nome");
  return r.rows.map((x) => ({ id: x.id, nome: x.nome, email: x.email, papel: x.papel, criadoEm: x.criado_em }));
}

/**
 * Cria o administrador inicial a partir das variáveis de ambiente.
 * Idempotente: se o e-mail já existe, apenas garante que o papel é ADM.
 */
export async function semearAdmin(): Promise<void> {
  if (!ADMIN_EMAIL || !ADMIN_SENHA) {
    console.log("[gateway] ADMIN_EMAIL/ADMIN_SENHA não definidos; nenhum administrador inicial criado");
    return;
  }
  const existente = await porEmail(ADMIN_EMAIL);
  if (existente) {
    if (existente.papel !== "ADM") {
      await atualizar(pool, existente.id, { papel: "ADM" });
      console.log(`[gateway] conta ${ADMIN_EMAIL} promovida a ADM`);
    }
    return;
  }
  const u = await criar(pool, ADMIN_NOME, ADMIN_EMAIL, "ADM", await bcrypt.hash(ADMIN_SENHA, 10));
  console.log(`[gateway] administrador inicial criado: ${u.email}`);
}
