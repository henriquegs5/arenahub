import { Request, Response, Router } from "express";
import { pool } from "./db";
import { Autor, UUID_RE, erro, exigir } from "./auth";
import { LIMITE_POR_COMPRADOR, PEDIDO_EXPIRA_SEGUNDOS } from "./config";
import { STATUS_PEDIDO, StatusIngresso, StatusPedido, TransicaoInvalida, estadoPedido } from "./estados";
import { MEIOS_PAGAMENTO, emReais } from "./meios";
import * as repo from "./repositorio";
import * as servico from "./servico";
import { ErroNegocio } from "./servico";
import { exigirAdm } from "./auth";
import { contarDLQ, descartarDLQ, listarDLQ, reprocessarDLQ } from "./messaging";

/**
 * Rotas REST (JSON) do serviço de ingressos.
 *
 * A COMPRA responde 202, não 201: o pedido nasce PENDENTE e a Saga resolve o
 * resto por eventos. A tela acompanha o pedido mudando de estado.
 *
 * Toda permissão é verificada aqui, no backend.
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


function tratar(res: Response, e: unknown) {
  if (e instanceof ErroNegocio) return erro(res, e.status, e.message);
  if (e instanceof TransicaoInvalida) return erro(res, 409, e.message);
  console.error(e);
  return erro(res, 500, "erro interno");
}

const idDe = (req: Request, res: Response, campo = "id"): string | null => {
  const v = req.params[campo];
  if (!UUID_RE.test(v)) { erro(res, 400, `${campo} inválido`); return null; }
  return v;
};

const limiteDe = (v: unknown) => Math.min(Math.max(parseInt(String(v ?? "50"), 10) || 50, 1), 200);

// ---------- quem enxerga o que ----------
//
// ADM        tudo.
// ORGANIZADOR as vendas e os ingressos dos PROPRIOS eventos (organizador_id).
// PARTICIPANTE so o que e seu.

const escopoPedidos = (a: Autor) =>
  a.papel === "ADM" ? { compradorId: null, organizadorId: null }
  : a.papel === "ORGANIZADOR" ? { compradorId: null, organizadorId: a.id }
  : { compradorId: a.id, organizadorId: null };

const podeVerPedido = (a: Autor, p: repo.Pedido) =>
  a.papel === "ADM" || p.compradorId === a.id ||
  (a.papel === "ORGANIZADOR" && p.organizadorId === a.id);

const podeVerIngresso = (a: Autor, i: repo.Ingresso) =>
  a.papel === "ADM" || i.titularId === a.id ||
  (a.papel === "ORGANIZADOR" && i.organizadorId === a.id);

// ---------- apresentação ----------

const pedidoPublico = (p: repo.Pedido, itens: repo.ItemPedido[], ingressos: repo.Ingresso[] = []) => ({
  id: p.id,
  eventoId: p.eventoId,
  compradorId: p.compradorId,
  status: p.status,
  emAndamento: estadoPedido(p.status).emAndamento(),
  podeCancelar: estadoPedido(p.status).aceitaCancelamento(),
  totalCentavos: p.totalCentavos,
  total: emReais(p.totalCentavos),
  meio: p.meio,
  motivo: p.motivo,
  eventoNome: p.eventoNome,
  eventoDataHora: p.eventoDataHora,
  eventoLocal: p.eventoLocal,
  expiraEm: p.expiraEm,
  criadoEm: p.criadoEm,
  atualizadoEm: p.atualizadoEm,
  itens: itens.map((i) => ({
    loteId: i.loteId,
    setorNome: i.setorNome,
    loteNome: i.loteNome,
    quantidade: i.quantidade,
    politica: i.politica,
    precoUnitarioCentavos: i.precoUnitarioCentavos,
    precoUnitario: emReais(i.precoUnitarioCentavos),
  })),
  ingressos: ingressos.map(ingressoPublico),
});

const ingressoPublico = (i: repo.Ingresso) => ({
  id: i.id,
  pedidoId: i.pedidoId,
  eventoId: i.eventoId,
  titularId: i.titularId,
  codigo: i.codigo,
  setorNome: i.setorNome,
  loteNome: i.loteNome,
  politica: i.politica,
  precoCentavos: i.precoCentavos,
  preco: emReais(i.precoCentavos),
  status: i.status,
  eventoNome: i.eventoNome,
  eventoDataHora: i.eventoDataHora,
  eventoLocal: i.eventoLocal,
  emitidoEm: i.emitidoEm,
  validadoEm: i.validadoEm,
  validadoPor: i.validadoPor,
});

// ---------- metadados (antes de "/:id", senão a rota genérica captura) ----------

/**
 * Regras da compra que a tela precisa conhecer: meios aceitos, limite por
 * comprador e prazo de expiração do pedido.
 */
router.get("/meta/regras", (req: Request, res: Response) => {
  const a = exigir(req, res); if (!a) return;
  res.json({
    meios: MEIOS_PAGAMENTO,
    limitePorComprador: LIMITE_POR_COMPRADOR,
    pedidoExpiraSegundos: PEDIDO_EXPIRA_SEGUNDOS,
  });
});

// ================= pedidos =================

/**
 * Inicia a compra. Responde 202: o pedido nasce PENDENTE e a Saga resolve.
 */
router.post("/pedidos", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;

    const { eventoId, itens, meio, referenciaPagamento } = req.body ?? {};
    if (!UUID_RE.test(eventoId)) return erro(res, 400, "eventoId inválido");
    if (!Array.isArray(itens)) return erro(res, 400, "informe os itens da compra");

    for (const i of itens) {
      if (!UUID_RE.test(i?.loteId)) return erro(res, 400, "loteId inválido");
      if (typeof i?.politica !== "string") return erro(res, 400, "política de preço inválida");
    }

    const pedido = await servico.solicitarCompra(
      {
        eventoId,
        itens: itens.map((i: any) => ({
          loteId: i.loteId,
          quantidade: i.quantidade,
          politica: i.politica,
        })),
        meio: String(meio ?? ""),
        referenciaPagamento: String(referenciaPagamento ?? ""),
      },
      a,
      res.locals.correlationId
    );

    const completo = pedidoPublico(pedido, await repo.itensDoPedido(pool, pedido.id));
    res.status(202).json({
      ...completo,
      mensagem: "pedido recebido; os lugares estão sendo reservados e o pagamento processado",
    });
  } catch (e) { tratar(res, e); }
});

/** Pedidos do usuário; o ADM vê todos. Filtros: ?status=&eventoId= */
router.get("/pedidos", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;

    const status = req.query.status as StatusPedido | undefined;
    if (status && !STATUS_PEDIDO.includes(status)) return erro(res, 400, "status inválido");

    const eventoId = typeof req.query.eventoId === "string" ? req.query.eventoId : undefined;
    if (eventoId && !UUID_RE.test(eventoId)) return erro(res, 400, "eventoId inválido");

    const pedidos = await repo.listarPedidos({
      ...escopoPedidos(a),
      eventoId,
      status,
      limite: limiteDe(req.query.limite),
    });

    const completos = await Promise.all(pedidos.map(async (p) => pedidoPublico(
      p,
      await repo.itensDoPedido(pool, p.id),
      await repo.ingressosDoPedido(pool, p.id)
    )));

    res.json(completos);
  } catch (e) { tratar(res, e); }
});

router.get("/pedidos/:id", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const p = await repo.buscarPedido(pool, id);
    if (!p) return erro(res, 404, "pedido não encontrado");
    if (!podeVerPedido(a, p))
      return erro(res, 403, "você só pode ver os seus próprios pedidos");

    res.json(pedidoPublico(p, await repo.itensDoPedido(pool, id), await repo.ingressosDoPedido(pool, id)));
  } catch (e) { tratar(res, e); }
});

/** Histórico do pedido: quem fez o quê e quando (padrão Command). */
router.get("/pedidos/:id/historico", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const p = await repo.buscarPedido(pool, id);
    if (!p) return erro(res, 404, "pedido não encontrado");
    if (!podeVerPedido(a, p))
      return erro(res, 403, "você só pode ver os seus próprios pedidos");

    res.json(await repo.historicoDoPedido(pool, id));
  } catch (e) { tratar(res, e); }
});

router.post("/pedidos/:id/cancelar", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    await servico.cancelar(id, a, motivo, res.locals.correlationId);

    const p = (await repo.buscarPedido(pool, id))!;
    res.json(pedidoPublico(p, await repo.itensDoPedido(pool, id), await repo.ingressosDoPedido(pool, id)));
  } catch (e) { tratar(res, e); }
});

// ================= ingressos =================

/** Ingressos do usuário; o ADM vê todos. Filtros: ?status=&eventoId= */
router.get("/", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;

    const status = req.query.status as StatusIngresso | undefined;
    const eventoId = typeof req.query.eventoId === "string" ? req.query.eventoId : undefined;
    if (eventoId && !UUID_RE.test(eventoId)) return erro(res, 400, "eventoId inválido");

    const ingressos = await repo.listarIngressos({
      titularId: a.papel === "ADM" || a.papel === "ORGANIZADOR" ? null : a.id,
      organizadorId: a.papel === "ORGANIZADOR" ? a.id : null,
      eventoId,
      status,
      limite: limiteDe(req.query.limite),
    });

    res.json(ingressos.map(ingressoPublico));
  } catch (e) { tratar(res, e); }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const i = await repo.buscarIngresso(pool, id);
    if (!i) return erro(res, 404, "ingresso não encontrado");
    if (!podeVerIngresso(a, i))
      return erro(res, 403, "você só pode ver os seus próprios ingressos");

    res.json(ingressoPublico(i));
  } catch (e) { tratar(res, e); }
});

router.post("/:id/cancelar", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    res.json(ingressoPublico(await servico.cancelarIngresso(id, a, res.locals.correlationId)));
  } catch (e) { tratar(res, e); }
});

// ================= validação na entrada =================

/**
 * Check-in. Responde SEMPRE 200 com `aprovado: true|false` e o motivo, mesmo
 * quando recusa: a portaria precisa ler o motivo na tela, não um erro genérico.
 */
router.post("/validar", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;

    const codigo = typeof req.body?.codigo === "string" ? req.body.codigo.trim() : "";
    if (codigo.length < 4) return erro(res, 400, "informe o código do ingresso");

    const r = await servico.validarEntrada(codigo, a, res.locals.correlationId);
    res.json({
      aprovado: r.aprovado,
      motivo: r.motivo,
      ingresso: r.ingresso ? ingressoPublico(r.ingresso) : null,
    });
  } catch (e) { tratar(res, e); }
});
