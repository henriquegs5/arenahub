import { Request, Response } from "express";

/**
 * Identidade de quem chama. O Gateway valida o JWT, apaga qualquer `x-user-*`
 * vindo do cliente e injeta estes cabeçalhos; as portas dos serviços não são
 * expostas fora da rede do Docker, por isso o serviço confia neles.
 *
 * Arquivo duplicado de propósito em cada serviço (sem biblioteca compartilhada).
 */
export type Papel = "PARTICIPANTE" | "ORGANIZADOR" | "ADM";
export const PAPEIS: Papel[] = ["PARTICIPANTE", "ORGANIZADOR", "ADM"];

export interface Autor {
  id: string;
  papel: Papel;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const erro = (res: Response, status: number, mensagem: string) =>
  res.status(status).json({ erro: mensagem });

/** Quem está chamando, ou null se o cabeçalho não veio. */
export function quem(req: Request): Autor | null {
  const id = req.headers["x-user-id"];
  const papel = req.headers["x-user-role"];
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  if (!PAPEIS.includes(papel as Papel)) return null;
  return { id, papel: papel as Papel };
}

export const ehAdm = (a: Autor | null): boolean => a?.papel === "ADM";

/** Verdadeiro quando o autor é o próprio dono do recurso ou um administrador. */
export const donoOuAdm = (a: Autor | null, donoId: string): boolean =>
  !!a && (a.id === donoId || a.papel === "ADM");

/**
 * Exige autenticação. Responde 401 e devolve null quando não há identidade.
 * Uso: `const a = exigir(req, res); if (!a) return;`
 */
export function exigir(req: Request, res: Response): Autor | null {
  const a = quem(req);
  if (!a) {
    erro(res, 401, "não autenticado");
    return null;
  }
  return a;
}

/** Exige administrador. Responde 401/403 e devolve null quando não for. */
export function exigirAdm(req: Request, res: Response): Autor | null {
  const a = exigir(req, res);
  if (!a) return null;
  if (a.papel !== "ADM") {
    erro(res, 403, "ação restrita ao administrador");
    return null;
  }
  return a;
}

/** Exige um dos papéis informados. Responde 401/403 e devolve null quando não for. */
export function exigirPapel(req: Request, res: Response, ...papeis: Papel[]): Autor | null {
  const a = exigir(req, res);
  if (!a) return null;
  if (a.papel !== "ADM" && !papeis.includes(a.papel)) {
    erro(res, 403, `ação restrita a: ${papeis.join(", ")}`);
    return null;
  }
  return a;
}
