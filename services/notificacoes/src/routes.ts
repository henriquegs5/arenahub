import { Router } from "express";
import * as repo from "./repositorio";

export const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function responder(res: any, filtros: { usuarioId?: string; torneioId?: string; limite?: unknown }) {
  try {
    const limite = Math.min(Math.max(parseInt(String(filtros.limite ?? "50"), 10) || 50, 1), 200);
    res.json(await repo.listar({ usuarioId: filtros.usuarioId, torneioId: filtros.torneioId, limite }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "erro interno" });
  }
}

// Avisos do usuário logado (boas-vindas etc.)
router.get("/minhas", (req, res) => {
  const uid = req.headers["x-user-id"] as string | undefined;
  if (!uid) return void res.status(401).json({ erro: "não autenticado" });
  return responder(res, { usuarioId: uid, limite: req.query.limite });
});

// Feed geral, com filtro opcional por torneio: GET /?torneioId=...
router.get("/", (req, res) => {
  const torneioId = req.query.torneioId as string | undefined;
  if (torneioId && !UUID_RE.test(torneioId)) return void res.status(400).json({ erro: "torneioId inválido" });
  return responder(res, { torneioId, limite: req.query.limite });
});
