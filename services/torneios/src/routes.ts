import { Request, Response, Router } from "express";
import { Chave } from "./chave";
import { pool } from "./db";
import { TransicaoInvalida } from "./estados";
import { FORMATOS, Formato } from "./formatos";
import * as repo from "./repositorio";
import * as servico from "./servico";

export const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const erro = (res: Response, status: number, mensagem: string) => res.status(status).json({ erro: mensagem });
const quem = (req: Request) => ({
  id: req.headers["x-user-id"] as string | undefined,
  papel: req.headers["x-user-role"] as string | undefined,
});

function tratar(res: Response, e: unknown) {
  if (e instanceof servico.ErroNegocio) return erro(res, e.status, e.message);
  if (e instanceof TransicaoInvalida) return erro(res, 409, e.message);
  if ((e as any)?.code === "23505") return erro(res, 409, "esta equipe já está inscrita neste torneio");
  console.error(e);
  return erro(res, 500, "erro interno");
}

router.post("/", async (req, res) => {
  try {
    const u = quem(req);
    if (!u.id) return erro(res, 401, "não autenticado");
    if (u.papel !== "ORGANIZADOR") return erro(res, 403, "somente organizadores criam torneios");
    const { nome, formato, maxEquipes } = req.body ?? {};
    if (typeof nome !== "string" || nome.trim().length < 2) return erro(res, 400, "nome inválido");
    if (!FORMATOS.includes(formato)) return erro(res, 400, `formato deve ser um de: ${FORMATOS.join(", ")}`);
    if (!Number.isInteger(maxEquipes) || maxEquipes < 2 || maxEquipes > 32) return erro(res, 400, "maxEquipes deve ser inteiro entre 2 e 32");
    res.status(201).json(await repo.criarTorneio(nome.trim(), formato as Formato, maxEquipes, u.id));
  } catch (e) { tratar(res, e); }
});

router.get("/", async (_req, res) => {
  try { res.json(await repo.listarTorneios()); } catch (e) { tratar(res, e); }
});

function validarId(req: Request, res: Response): string | null {
  if (!UUID_RE.test(req.params.id)) { erro(res, 400, "id inválido"); return null; }
  return req.params.id;
}

router.get("/:id", async (req, res) => {
  try {
    const id = validarId(req, res); if (!id) return;
    const t = await repo.buscarTorneio(id);
    if (!t) return erro(res, 404, "torneio não encontrado");
    res.json(t);
  } catch (e) { tratar(res, e); }
});

router.get("/:id/inscricoes", async (req, res) => {
  try {
    const id = validarId(req, res); if (!id) return;
    res.json(await repo.listarInscricoes(id));
  } catch (e) { tratar(res, e); }
});

router.get("/:id/chave", async (req, res) => {
  try {
    const id = validarId(req, res); if (!id) return;
    const chave = Chave.deRegistros(await repo.carregarPartidas(pool, id));
    res.json(chave.listaRodadas().map((r) => ({
      rodada: r.numero,
      partidas: r.partidas().map((p) => ({
        partidaId: p.id, ordem: p.ordem, equipeA: p.equipeA, equipeB: p.equipeB, bye: p.bye,
        status: p.status, placarA: p.placarA, placarB: p.placarB, vencedorId: p.vencedorId,
      })),
    })));
  } catch (e) { tratar(res, e); }
});

router.post("/:id/abrir", async (req, res) => {
  try {
    const id = validarId(req, res); if (!id) return;
    const u = quem(req); if (!u.id) return erro(res, 401, "não autenticado");
    await servico.abrirInscricoes(id, u.id);
    res.json(await repo.buscarTorneio(id));
  } catch (e) { tratar(res, e); }
});

router.post("/:id/inscricoes", async (req, res) => {
  try {
    const id = validarId(req, res); if (!id) return;
    const u = quem(req);
    if (!u.id) return erro(res, 401, "não autenticado");
    if (u.papel !== "JOGADOR") return erro(res, 403, "somente jogadores inscrevem equipes");
    const equipeId = req.body?.equipeId;
    if (typeof equipeId !== "string" || !UUID_RE.test(equipeId)) return erro(res, 400, "equipeId inválido");
    await servico.inscrever(id, equipeId, u.id, res.locals.correlationId);
    // 202: a validação acontece de forma assíncrona (Saga). Consulte GET /:id/inscricoes.
    res.status(202).json({ mensagem: "inscrição solicitada; aguardando validação da equipe" });
  } catch (e) { tratar(res, e); }
});

router.post("/:id/iniciar", async (req, res) => {
  try {
    const id = validarId(req, res); if (!id) return;
    const u = quem(req); if (!u.id) return erro(res, 401, "não autenticado");
    await servico.iniciar(id, u.id, res.locals.correlationId);
    res.json(await repo.buscarTorneio(id));
  } catch (e) { tratar(res, e); }
});

router.post("/:id/cancelar", async (req, res) => {
  try {
    const id = validarId(req, res); if (!id) return;
    const u = quem(req); if (!u.id) return erro(res, 401, "não autenticado");
    await servico.cancelar(id, u.id);
    res.json(await repo.buscarTorneio(id));
  } catch (e) { tratar(res, e); }
});
