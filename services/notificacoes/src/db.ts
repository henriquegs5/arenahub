import { Pool } from "pg";
import { DATABASE_URL } from "./config";

// Cada serviço acessa SOMENTE o próprio banco (Database per Service).
export const pool = new Pool({ connectionString: DATABASE_URL });

export async function dbOk(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
