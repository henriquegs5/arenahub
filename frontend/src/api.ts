// Todas as chamadas passam pelo Gateway (/api/...). O nginx do container encaminha.
export class ApiError extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem); }
}

let token: string | null = null;
let aoNaoAutorizado: (() => void) | null = null;
export const setToken = (t: string | null) => { token = t; };
export const setAoNaoAutorizado = (fn: (() => void) | null) => { aoNaoAutorizado = fn; };

export async function api<T>(metodo: "GET" | "POST" | "PATCH" | "DELETE", caminho: string, corpo?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (corpo !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let r: Response;
  try {
    r = await fetch(`/api/${caminho}`, { method: metodo, headers, body: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  } catch {
    throw new ApiError(0, "sem conexão com o servidor");
  }
  const texto = await r.text();
  let dados: any = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!r.ok) {
    if (r.status === 401 && token) aoNaoAutorizado?.();
    throw new ApiError(r.status, dados?.erro ?? `erro ${r.status}`);
  }
  return dados as T;
}

export async function statusServicos(): Promise<Record<string, import("./types").StatusServico>> {
  const r = await fetch("/status");
  if (!r.ok) throw new Error("status indisponível");
  return r.json();
}
