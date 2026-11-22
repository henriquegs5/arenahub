import { Router, Request, Response } from "express";
import { Autor, UUID_RE, erro, exigir } from "./auth";
import * as repo from "./repositorio";
import { exigirAdm } from "./auth";
import { contarDLQ, descartarDLQ, listarDLQ, reprocessarDLQ } from "./messaging";

/**
 * Rotas REST (JSON) do serviço de notificações.
 *
 * PERMISSÃO: cada aviso pertence a um destinatário. A listagem devolve APENAS os
 * avisos do usuário autenticado; o administrador pode ver todos. A verificação é
 * feita aqui, no backend — esconder o botão na tela não é controle de acesso.
 *
 * O CONTROLE DE LEITURA mora no banco, não no navegador. Antes era `localStorage`,
 * o que estava errado: a marcação sumia ao trocar de máquina e o contador
 * discordava entre abas.
 */
export const router = Router();

// ---------- dead letter (somente ADM) ----------
//
// Mensagem que falha de forma permanente no consumidor NAO e descartada: vai para
// `<servico>.events.dlq`. Estas rotas deixam o administrador ver o que ficou
// parado, devolver a mensagem a fila para nova tentativa ou descarta-la de vez.
// Declaradas ANTES das rotas com parametro, que as capturariam.

router.get("/dlq", async (req: Request, res: Response) => {
  if (!exigirAdm(req, res)) return;
  try {
    res.json({ total: await contarDLQ(), mensagens: await listarDLQ(50) });
  } catch (e) { console.error(e); res.status(500).json({ erro: "erro interno" }); }
});

router.post("/dlq/reprocessar", async (req: Request, res: Response) => {
  if (!exigirAdm(req, res)) return;
  try { res.json({ reprocessadas: await reprocessarDLQ(50) }); }
  catch (e) { console.error(e); res.status(500).json({ erro: "erro interno" }); }
});

router.delete("/dlq", async (req: Request, res: Response) => {
  if (!exigirAdm(req, res)) return;
  try { res.json({ descartadas: await descartarDLQ() }); }
  catch (e) { console.error(e); res.status(500).json({ erro: "erro interno" }); }
});


const limiteDe = (v: unknown) => Math.min(Math.max(parseInt(String(v ?? "50"), 10) || 50, 1), 200);
const ehVerdade = (v: unknown) => v === "1" || v === "true";

/** O ADM enxerga a plataforma inteira; os demais, só o que é seu. */
const escopo = (a: Autor): string | null => (a.papel === "ADM" ? null : a.id);

/**
 * Localiza um aviso e confere se o autor pode mexer nele.
 * Devolve null (e já respondeu) quando não existe ou não é dele.
 */
async function avisoSob(req: Request, res: Response, a: Autor): Promise<repo.LinhaNotificacao | null> {
  const id = req.params.id;
  if (!UUID_RE.test(id)) { erro(res, 400, "id inválido"); return null; }

  const aviso = await repo.buscar(id);
  // Para quem não é ADM, um aviso de outra pessoa não existe: 404, não 403,
  // para não revelar que o aviso existe.
  if (!aviso || (a.papel !== "ADM" && aviso.usuarioId !== a.id)) {
    erro(res, 404, "aviso não encontrado");
    return null;
  }
  return aviso;
}

const tratar = (res: Response, e: unknown) => {
  console.error(e);
  erro(res, 500, "erro interno");
};

// ---------- leitura ----------

/** Avisos do usuário autenticado. Filtro: ?naoLidas=1 */
router.get("/minhas", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    res.json(await repo.listar({
      usuarioId: a.id,
      apenasNaoLidas: ehVerdade(req.query.naoLidas),
      limite: limiteDe(req.query.limite),
    }));
  } catch (e) { tratar(res, e); }
});

/**
 * Listagem geral. Para o ADM, são todos os avisos da plataforma; para os demais,
 * é exatamente o mesmo que /minhas — nunca os avisos de outra pessoa.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    res.json(await repo.listar({
      usuarioId: escopo(a),
      apenasNaoLidas: ehVerdade(req.query.naoLidas),
      limite: limiteDe(req.query.limite),
    }));
  } catch (e) { tratar(res, e); }
});

/**
 * Contador de não lidas, consultado a cada ciclo da interface.
 * Responde só um número, em vez de a tela baixar a lista inteira para contar.
 */
router.get("/contador", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    res.json({ naoLidas: await repo.contarNaoLidas(escopo(a)) });
  } catch (e) { tratar(res, e); }
});

// ---------- marcar como lida ----------

router.post("/lidas", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    res.json({ marcadas: await repo.marcarTodasLidas(escopo(a)) });
  } catch (e) { tratar(res, e); }
});

router.post("/:id/lida", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const aviso = await avisoSob(req, res, a); if (!aviso) return;
    await repo.marcarLida(aviso.id);
    res.json((await repo.buscar(aviso.id))!);
  } catch (e) { tratar(res, e); }
});

/** Desfaz a marcação, para quem clicou sem querer. */
router.post("/:id/nao-lida", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const aviso = await avisoSob(req, res, a); if (!aviso) return;
    await repo.marcarNaoLida(aviso.id);
    res.json((await repo.buscar(aviso.id))!);
  } catch (e) { tratar(res, e); }
});

// ---------- excluir ----------

/** Limpeza em massa: descarta os avisos JÁ LIDOS do próprio escopo. */
router.delete("/lidas", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    res.json({ removidas: await repo.removerLidas(escopo(a)) });
  } catch (e) { tratar(res, e); }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const aviso = await avisoSob(req, res, a); if (!aviso) return;
    await repo.remover(aviso.id);
    res.json({ removido: aviso.id });
  } catch (e) { tratar(res, e); }
});
