import { Request, Response, Router } from "express";
import { Comando, ConfirmarResultado, ContestarResultado, ErroRegra, InformarResultado, ResolverContestacao } from "./comandos";
import { TransicaoInvalida } from "./estados";
import * as repo from "./repositorio";
import * as servico from "./servico";

export const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const erro = (res: Response, status: number, mensagem: string) => res.status(status).json({ erro: mensagem });
const usuario = (req: Request) => req.headers["x-user-id"] as string | undefined;

function tratar(res: Response, e: unknown) {
  if (e instanceof ErroRegra) return erro(res, e.status, e.message);
  if (e instanceof TransicaoInvalida) return erro(res, 409, e.message);
  console.error(e);
  return erro(res, 500, "erro interno");
}

router.get("/", async (req, res) => {
  try {
    const { torneioId, status } = req.query as Record<string, string | undefined>;
    if (torneioId && !UUID_RE.test(torneioId)) return erro(res, 400, "torneioId inválido");
    res.json(await repo.listar({ torneioId, status }));
  } catch (e) { tratar(res, e); }
});

router.get("/:id", async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return erro(res, 400, "id inválido");
    const p = await repo.buscar(req.params.id);
    if (!p) return erro(res, 404, "partida não encontrada");
    res.json({ ...p, historico: await repo.historico(p.id) });
  } catch (e) { tratar(res, e); }
});

/** Monta a rota de um comando: valida id/usuário, executa e devolve a partida atualizada. */
function rotaComando(caminho: string, fabrica: (uid: string, body: any) => Comando) {
  router.post(`/:id/${caminho}`, async (req, res) => {
    try {
      const uid = usuario(req);
      if (!uid) return erro(res, 401, "não autenticado");
      if (!UUID_RE.test(req.params.id)) return erro(res, 400, "id inválido");
      const p = await servico.executar(req.params.id, fabrica(uid, req.body ?? {}), res.locals.correlationId);
      res.json(p);
    } catch (e) { tratar(res, e); }
  });
}

rotaComando("resultado", (uid, b) => new InformarResultado(uid, b.placarA, b.placarB));
rotaComando("confirmar", (uid) => new ConfirmarResultado(uid));
rotaComando("contestar", (uid, b) => new ContestarResultado(uid, b.motivo));
rotaComando("resolver", (uid, b) => new ResolverContestacao(uid, b.placarA, b.placarB));
