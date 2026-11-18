import { randomUUID } from "node:crypto";
import { pool } from "./db";

export type Papel = "JOGADOR" | "ORGANIZADOR";

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
      papel       TEXT NOT NULL CHECK (papel IN ('JOGADOR','ORGANIZADOR')),
      senha_hash  TEXT NOT NULL,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

const map = (r: any): Usuario => ({
  id: r.id, nome: r.nome, email: r.email, papel: r.papel, senhaHash: r.senha_hash,
});

export async function criar(nome: string, email: string, papel: Papel, senhaHash: string): Promise<Usuario> {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO usuarios (id, nome, email, papel, senha_hash) VALUES ($1,$2,$3,$4,$5)",
    [id, nome, email, papel, senhaHash]
  );
  return { id, nome, email, papel, senhaHash };
}

export async function porEmail(email: string): Promise<Usuario | null> {
  const r = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

export async function porId(id: string): Promise<Usuario | null> {
  const r = await pool.query("SELECT * FROM usuarios WHERE id = $1", [id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}

/** Lista pública (sem e-mail nem senha) para a interface escolher membros por nome. */
export async function listarPublico(): Promise<{ id: string; nome: string; papel: Papel }[]> {
  const r = await pool.query("SELECT id, nome, papel FROM usuarios ORDER BY nome");
  return r.rows;
}
