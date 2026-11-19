import { Request, Response, Router } from "express";
import { pool } from "./db";
import { UUID_RE, erro, exigir } from "./auth";
import { CENTAVOS_RECUSA, MEIOS_PAGAMENTO, emReais, estrategiaPara } from "./meios";
import { mascararReferencia } from "./provedor";
import * as repo from "./repositorio";
import { exigirAdm } from "./auth";
import { contarDLQ, descartarDLQ, listarDLQ, reprocessarDLQ } from "./messaging";

/**
 * Rotas REST (JSON) do serviço de pagamento.
 *
 * O estorno NÃO é disparado por aqui: ele faz parte da Saga e é pedido pelo
 * serviço de Ingressos ao cancelar um pedido ou um evento. Esta API é de
 * CONSULTA — é o que a tela de "Pedidos e pagamentos" mostra.
 *
 * O comprador vê apenas as próprias transações; o ADM vê todas. Verificado aqui,
 * no backend.
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


/** A referência do meio de pagamento nunca sai inteira da API. */
const publico = (t: repo.Transacao) => ({
  id: t.id,
  pedidoId: t.pedidoId,
  compradorId: t.compradorId,
  valorCentavos: t.valorCentavos,
  valor: emReais(t.valorCentavos),
  meio: t.meio,
  meioRotulo: estrategiaPara(t.meio).rotulo,
  referenciaPagamento: mascararReferencia(t.referenciaPagamento),
  status: t.status,
  autorizacao: t.autorizacao,
  motivo: t.motivo,
  criadoEm: t.criadoEm,
  estornadoEm: t.estornadoEm,
});

/**
 * Meios de pagamento disponíveis, com o gatilho da recusa simulada declarado.
 * A tela de compra mostra isto ao apresentador na hora da demonstração.
 */
router.get("/meta/meios", (req: Request, res: Response) => {
  const a = exigir(req, res); if (!a) return;
  res.json({
    meios: MEIOS_PAGAMENTO.map((m) => {
      const e = estrategiaPara(m);
      return {
        valor: m,
        rotulo: e.rotulo,
        limiteCentavos: e.limiteCentavos,
        aceitaEstorno: e.aceitaEstorno(),
        recusaSempre: m === "CARTAO_RECUSADO",
      };
    }),
    // Documentado também no README, seção "Provocar uma recusa de pagamento".
    gatilhosDeRecusa: [
      {
        gatilho: "meio de pagamento",
        comoProvocar: 'escolher o meio "Cartão de teste (recusa sempre)"',
        efeito: "recusa qualquer valor, sempre",
      },
      {
        gatilho: "valor",
        comoProvocar: `fazer o total terminar em ${CENTAVOS_RECUSA} centavos (ex.: R$ 80,66)`,
        efeito: "recusa em qualquer meio de pagamento",
      },
    ],
  });
});

/** Transações do usuário autenticado; o ADM vê todas. */
router.get("/", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const limite = Math.min(Math.max(parseInt(String(req.query.limite ?? "50"), 10) || 50, 1), 200);
    const transacoes = await repo.listar({ compradorId: a.papel === "ADM" ? null : a.id, limite });
    res.json(transacoes.map(publico));
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});

/** Transação de um pedido específico. */
router.get("/pedido/:pedidoId", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    if (!UUID_RE.test(req.params.pedidoId)) return erro(res, 400, "pedidoId inválido");

    const t = await repo.buscarPorPedido(pool, req.params.pedidoId);
    if (!t) return erro(res, 404, "nenhum pagamento para este pedido");
    if (a.papel !== "ADM" && t.compradorId !== a.id)
      return erro(res, 403, "você só pode consultar os seus próprios pagamentos");

    res.json(publico(t));
  } catch (e) {
    console.error(e);
    erro(res, 500, "erro interno");
  }
});
