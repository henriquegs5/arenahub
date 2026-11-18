import { Request, Response, Router } from "express";
import { TAMANHO_MAX } from "./config";
import { publishEvent } from "./messaging";
import * as repo from "./repositorio";

export const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const erro = (res: Response, status: number, mensagem: string) => res.status(status).json({ erro: mensagem });
const quem = (req: Request) => ({
  id: req.headers["x-user-id"] as string | undefined,
  papel: req.headers["x-user-role"] as string | undefined,
});
const violacao = (e: any, constraint?: string) => e?.code === "23505" && (!constraint || e.constraint === constraint);

router.post("/", async (req: Request, res: Response) => {
  try {
    const u = quem(req);
    if (!u.id) return erro(res, 401, "não autenticado");
    if (u.papel !== "JOGADOR") return erro(res, 403, "somente jogadores criam equipes");
    const nome = req.body?.nome;
    if (typeof nome !== "string" || nome.trim().length < 2) return erro(res, 400, "nome inválido");

    const equipe = await repo.criar(nome.trim(), u.id);
    publishEvent("equipe.criada", 1, { equipeId: equipe.id, nome: equipe.nome, capitaoId: equipe.capitaoId }, res.locals.correlationId);
    res.status(201).json({ ...equipe, membros: [equipe.capitaoId] });
  } catch (e: any) {
    if (violacao(e, "equipes_nome_key")) return erro(res, 409, "já existe equipe com esse nome");
    if (violacao(e, "membros_pkey")) return erro(res, 409, "você já participa de uma equipe");
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

router.get("/", async (_req, res) => {
  try {
    res.json(await repo.listar());
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return erro(res, 400, "id inválido");
    const equipe = await repo.porId(req.params.id);
    if (!equipe) return erro(res, 404, "equipe não encontrada");
    res.json({ ...equipe, membros: await repo.membrosDe(equipe.id) });
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const u = quem(req);
    if (!UUID_RE.test(req.params.id)) return erro(res, 400, "id inválido");
    const equipe = await repo.porId(req.params.id);
    if (!equipe) return erro(res, 404, "equipe não encontrada");
    if (equipe.capitaoId !== u.id) return erro(res, 403, "somente o capitão pode alterar a equipe");
    const nome = req.body?.nome;
    if (typeof nome !== "string" || nome.trim().length < 2) return erro(res, 400, "nome inválido");

    await repo.renomear(equipe.id, nome.trim());
    publishEvent("equipe.atualizada", 1, { equipeId: equipe.id, nome: nome.trim() }, res.locals.correlationId);
    res.json({ ...equipe, nome: nome.trim() });
  } catch (e: any) {
    if (violacao(e, "equipes_nome_key")) return erro(res, 409, "já existe equipe com esse nome");
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

router.post("/:id/membros", async (req, res) => {
  try {
    const u = quem(req);
    if (!UUID_RE.test(req.params.id)) return erro(res, 400, "id inválido");
    const equipe = await repo.porId(req.params.id);
    if (!equipe) return erro(res, 404, "equipe não encontrada");
    if (equipe.capitaoId !== u.id) return erro(res, 403, "somente o capitão adiciona membros");
    const usuarioId = req.body?.usuarioId;
    if (typeof usuarioId !== "string" || !UUID_RE.test(usuarioId)) return erro(res, 400, "usuarioId inválido");

    if ((await repo.adicionarMembro(equipe.id, usuarioId, TAMANHO_MAX)) === "cheia")
      return erro(res, 409, `equipe já tem o máximo de ${TAMANHO_MAX} membros`);
    res.status(201).json({ equipeId: equipe.id, membros: await repo.membrosDe(equipe.id) });
  } catch (e: any) {
    if (violacao(e, "membros_pkey")) return erro(res, 409, "usuário já participa de uma equipe");
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

router.delete("/:id/membros/:usuarioId", async (req, res) => {
  try {
    const u = quem(req);
    const { id, usuarioId } = req.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(usuarioId)) return erro(res, 400, "id inválido");
    const equipe = await repo.porId(id);
    if (!equipe) return erro(res, 404, "equipe não encontrada");
    if (equipe.capitaoId !== u.id) return erro(res, 403, "somente o capitão remove membros");
    if (usuarioId === equipe.capitaoId) return erro(res, 409, "o capitão não pode ser removido");
    if (!(await repo.removerMembro(id, usuarioId))) return erro(res, 404, "membro não encontrado");
    res.json({ equipeId: id, membros: await repo.membrosDe(id) });
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});
