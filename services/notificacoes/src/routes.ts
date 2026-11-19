import { Router, Request, Response } from "express";
import { erro, exigir } from "./auth";
import * as repo from "./repositorio";

/**
 * Rotas REST (JSON) do serviço de notificações.
 *
 * PERMISSÃO: cada aviso pertence a um destinatário. A listagem devolve APENAS os
 * avisos do usuário autenticado; o administrador pode ver todos. A verificação é
 * feita aqui, no backend — esconder o botão na tela não é controle de acesso.
 *
 * Marcar como lida, marcar todas, excluir e contador de não lidas entram no lote 4.
 */
export const router = Router();

const limiteDe = (v: unknown) => Math.min(Math.max(parseInt(String(v ?? "50"), 10) || 50, 1), 200);

/** Avisos do usuário autenticado. */
router.get("/minhas", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    res.json(await repo.listar({ usuarioId: a.id, limite: limiteDe(req.query.limite) }));
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

/**
 * Listagem geral. Para o ADM, são todos os avisos da plataforma; para os demais,
 * é exatamente o mesmo que /minhas — nunca os avisos de outra pessoa.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const usuarioId = a.papel === "ADM" ? null : a.id;
    res.json(await repo.listar({ usuarioId, limite: limiteDe(req.query.limite) }));
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});
