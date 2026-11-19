import { Request, Response, Router } from "express";
import { pool } from "./db";
import { Autor, UUID_RE, erro, exigir, exigirPapel } from "./auth";
import { STATUS_EVENTO, StatusEvento, TransicaoInvalida } from "./estados";
import { POLITICAS_PRECO, PoliticaPreco } from "./precos";
import * as repo from "./repositorio";
import * as servico from "./servico";
import { ErroNegocio } from "./servico";
import { exigirAdm } from "./auth";
import { contarDLQ, descartarDLQ, listarDLQ, reprocessarDLQ } from "./messaging";

/**
 * Rotas REST (JSON) do serviço de eventos, consumidas pelo frontend através do
 * Gateway. Toda permissão é verificada AQUI, no backend: esconder o botão na
 * tela não é controle de acesso.
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

// ---------- validação de entrada ----------

interface Problema { campo: string; mensagem: string }

function validarDadosEvento(corpo: any, obrigatorio: boolean): { dados: any; problemas: Problema[] } {
  const p: Problema[] = [];
  const dados: any = {};

  if (corpo?.nome !== undefined || obrigatorio) {
    if (typeof corpo?.nome !== "string" || corpo.nome.trim().length < 3)
      p.push({ campo: "nome", mensagem: "informe um nome com ao menos 3 caracteres" });
    else dados.nome = corpo.nome.trim();
  }

  if (corpo?.local !== undefined || obrigatorio) {
    if (typeof corpo?.local !== "string" || corpo.local.trim().length < 3)
      p.push({ campo: "local", mensagem: "informe o local do evento" });
    else dados.local = corpo.local.trim();
  }

  if (corpo?.dataHora !== undefined || obrigatorio) {
    const d = new Date(corpo?.dataHora);
    if (Number.isNaN(d.getTime()))
      p.push({ campo: "dataHora", mensagem: "informe uma data e hora válidas" });
    else dados.dataHora = d;
  }

  if (corpo?.descricao !== undefined) {
    if (corpo.descricao !== null && typeof corpo.descricao !== "string")
      p.push({ campo: "descricao", mensagem: "descrição inválida" });
    else dados.descricao = corpo.descricao === null ? null : String(corpo.descricao).trim();
  } else if (obrigatorio) {
    dados.descricao = null;
  }

  return { dados, problemas: p };
}

function validarDadosLote(corpo: any, obrigatorio: boolean): { dados: any; problemas: Problema[] } {
  const p: Problema[] = [];
  const dados: any = {};

  if (corpo?.nome !== undefined || obrigatorio) {
    if (typeof corpo?.nome !== "string" || corpo.nome.trim().length < 2)
      p.push({ campo: "nome", mensagem: "informe um nome para o lote" });
    else dados.nome = corpo.nome.trim();
  }

  if (corpo?.precoCentavos !== undefined || obrigatorio) {
    if (!Number.isInteger(corpo?.precoCentavos) || corpo.precoCentavos < 0)
      p.push({ campo: "precoCentavos", mensagem: "o preço deve ser um inteiro em centavos, zero ou maior" });
    else dados.precoCentavos = corpo.precoCentavos;
  }

  if (corpo?.capacidade !== undefined || obrigatorio) {
    if (!Number.isInteger(corpo?.capacidade) || corpo.capacidade < 1 || corpo.capacidade > 1_000_000)
      p.push({ campo: "capacidade", mensagem: "a capacidade deve ser um inteiro entre 1 e 1000000" });
    else dados.capacidade = corpo.capacidade;
  }

  if (corpo?.descontoPercentual !== undefined) {
    if (!Number.isInteger(corpo.descontoPercentual) || corpo.descontoPercentual < 0 || corpo.descontoPercentual > 100)
      p.push({ campo: "descontoPercentual", mensagem: "o desconto deve ser um inteiro de 0 a 100" });
    else dados.descontoPercentual = corpo.descontoPercentual;
  } else if (obrigatorio) {
    dados.descontoPercentual = 0;
  }

  if (corpo?.politicaPadrao !== undefined) {
    if (!POLITICAS_PRECO.includes(corpo.politicaPadrao))
      p.push({ campo: "politicaPadrao", mensagem: `política deve ser uma de: ${POLITICAS_PRECO.join(", ")}` });
    else dados.politicaPadrao = corpo.politicaPadrao;
  } else if (obrigatorio) {
    dados.politicaPadrao = "INTEIRA";
  }

  for (const campo of ["inicioVendas", "fimVendas"] as const) {
    if (corpo?.[campo] !== undefined) {
      if (corpo[campo] === null) { dados[campo] = null; continue; }
      const d = new Date(corpo[campo]);
      if (Number.isNaN(d.getTime())) p.push({ campo, mensagem: "data inválida" });
      else dados[campo] = d;
    } else if (obrigatorio) {
      dados[campo] = null;
    }
  }

  if (dados.inicioVendas && dados.fimVendas && dados.inicioVendas > dados.fimVendas)
    p.push({ campo: "fimVendas", mensagem: "o fim das vendas não pode ser antes do início" });

  if (corpo?.ativo !== undefined) {
    if (typeof corpo.ativo !== "boolean") p.push({ campo: "ativo", mensagem: "ativo deve ser verdadeiro ou falso" });
    else dados.ativo = corpo.ativo;
  } else if (obrigatorio) {
    dados.ativo = true;
  }

  return { dados, problemas: p };
}

const recusar = (res: Response, problemas: Problema[]) =>
  res.status(400).json({ erro: problemas[0].mensagem, problemas });

const rotuloPolitica = (p: PoliticaPreco): string =>
  p === "INTEIRA" ? "Inteira"
    : p === "MEIA" ? "Meia-entrada"
    : p === "PROMOCIONAL" ? "Promocional do lote"
    : "Cortesia";

/**
 * Políticas de preço disponíveis, para a tela montar o seletor.
 * Declarada ANTES de "/:id": o Express casa na ordem de registro, e "/meta/..."
 * seria capturada pela rota genérica.
 */
router.get("/meta/politicas", (req: Request, res: Response) => {
  const a = exigir(req, res); if (!a) return;
  res.json(POLITICAS_PRECO.map((p) => ({ valor: p, rotulo: rotuloPolitica(p) })));
});

// ================= catálogo e detalhe =================

/**
 * Catálogo. Quem não é ADM só enxerga eventos já publicados, mais os próprios
 * rascunhos se for organizador. Filtros: ?status=&busca=&meus=1
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;

    const status = req.query.status as StatusEvento | undefined;
    if (status && !STATUS_EVENTO.includes(status)) return erro(res, 400, "status inválido");

    const busca = typeof req.query.busca === "string" && req.query.busca.trim() ? req.query.busca.trim() : undefined;
    const soMeus = req.query.meus === "1" || req.query.meus === "true";

    const eventos = await repo.listarEventos({
      status,
      busca,
      organizadorId: a.id,
      verTudo: a.papel === "ADM",
      soDoOrganizador: soMeus ? a.id : undefined,
    });

    // O catálogo já traz capacidade, disponibilidade e preço mínimo, para a tela
    // não precisar de uma chamada por cartão.
    const resumo = await Promise.all(eventos.map(async (e) => {
      const arvore = await repo.carregarEstrutura(pool, e);
      return {
        id: e.id, nome: e.nome, descricao: e.descricao,
        dataHora: e.dataHora.toISOString(), local: e.local, status: e.status,
        organizadorId: e.organizadorId, motivoCancelamento: e.motivoCancelamento,
        capacidade: arvore.capacidade(),
        reservados: arvore.reservados(),
        disponiveis: arvore.disponiveis(),
        precoMinimoCentavos: arvore.precoMinimo(),
        setores: arvore.filhos().length,
      };
    }));

    res.json(resumo);
  } catch (e) { tratar(res, e); }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const e = await repo.buscarEvento(id);
    if (!e) return erro(res, 404, "evento não encontrado");

    // Rascunho é privado do organizador (e do ADM).
    const meu = e.organizadorId === a.id || a.papel === "ADM";
    if (!meu && e.status === "RASCUNHO") return erro(res, 404, "evento não encontrado");

    res.json(servico.detalhar(e, await repo.carregarEstrutura(pool, e)));
  } catch (e) { tratar(res, e); }
});

/** Disponibilidade agregada pelo Composite: evento, por setor e por lote. */
router.get("/:id/disponibilidade", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const e = await repo.buscarEvento(id);
    if (!e) return erro(res, 404, "evento não encontrado");

    const arvore = await repo.carregarEstrutura(pool, e);
    res.json({
      eventoId: e.id,
      capacidade: arvore.capacidade(),
      reservados: arvore.reservados(),
      disponiveis: arvore.disponiveis(),
      setores: arvore.filhos().map((s) => ({
        id: s.id, nome: s.nome,
        capacidade: s.capacidade(), reservados: s.reservados(), disponiveis: s.disponiveis(),
        lotes: s.filhos().map((l) => ({
          id: l.id, nome: l.nome,
          capacidade: l.capacidade(), reservados: l.reservados(), disponiveis: l.disponiveis(),
          vigente: l.vigente(),
        })),
      })),
    });
  } catch (e) { tratar(res, e); }
});

// ================= CRUD do evento =================

router.post("/", async (req: Request, res: Response) => {
  try {
    const a = exigirPapel(req, res, "ORGANIZADOR"); if (!a) return;
    const { dados, problemas } = validarDadosEvento(req.body, true);
    if (problemas.length) return recusar(res, problemas);

    const e = await servico.criar(dados, a);
    res.status(201).json(servico.detalhar(e, await repo.carregarEstrutura(pool, e)));
  } catch (e) { tratar(res, e); }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const { dados, problemas } = validarDadosEvento(req.body, false);
    if (problemas.length) return recusar(res, problemas);
    if (Object.keys(dados).length === 0) return erro(res, 400, "nada para alterar");

    const e = await servico.editar(id, a, dados, res.locals.correlationId);
    res.json(servico.detalhar(e, await repo.carregarEstrutura(pool, e)));
  } catch (e) { tratar(res, e); }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    await servico.excluir(id, a);
    res.json({ removido: id });
  } catch (e) { tratar(res, e); }
});

// ================= transições de estado =================

async function responderEvento(res: Response, id: string) {
  const e = (await repo.buscarEvento(id))!;
  res.json(servico.detalhar(e, await repo.carregarEstrutura(pool, e)));
}

router.post("/:id/publicar", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    await servico.publicar(id, a);
    await responderEvento(res, id);
  } catch (e) { tratar(res, e); }
});

router.post("/:id/abrir-vendas", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    await servico.abrirVendas(id, a);
    await responderEvento(res, id);
  } catch (e) { tratar(res, e); }
});

router.post("/:id/encerrar-vendas", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    await servico.encerrarVendas(id, a);
    await responderEvento(res, id);
  } catch (e) { tratar(res, e); }
});

router.post("/:id/realizar", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    await servico.realizar(id, a);
    await responderEvento(res, id);
  } catch (e) { tratar(res, e); }
});

router.post("/:id/cancelar", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    if (motivo.length < 3) return erro(res, 400, "informe o motivo do cancelamento");

    await servico.cancelar(id, a, motivo, res.locals.correlationId);
    await responderEvento(res, id);
  } catch (e) { tratar(res, e); }
});

// ================= setores =================

router.post("/:id/setores", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
    if (nome.length < 2) return erro(res, 400, "informe um nome para o setor");
    const descricao = typeof req.body?.descricao === "string" ? req.body.descricao.trim() : null;

    res.status(201).json(await servico.criarSetor(id, a, nome, descricao));
  } catch (e) { tratar(res, e); }
});

router.patch("/:id/setores/:setorId", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    const setorId = idDe(req, res, "setorId"); if (!setorId) return;

    const nome = req.body?.nome !== undefined ? String(req.body.nome).trim() : undefined;
    if (nome !== undefined && nome.length < 2) return erro(res, 400, "informe um nome para o setor");
    const descricao = req.body?.descricao !== undefined
      ? (req.body.descricao === null ? null : String(req.body.descricao).trim())
      : undefined;
    if (nome === undefined && descricao === undefined) return erro(res, 400, "nada para alterar");

    res.json(await servico.editarSetor(id, setorId, a, nome, descricao));
  } catch (e) { tratar(res, e); }
});

router.delete("/:id/setores/:setorId", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    const setorId = idDe(req, res, "setorId"); if (!setorId) return;
    await servico.excluirSetor(id, setorId, a);
    res.json({ removido: setorId });
  } catch (e) { tratar(res, e); }
});

// ================= lotes =================

router.post("/:id/setores/:setorId/lotes", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    const setorId = idDe(req, res, "setorId"); if (!setorId) return;

    const { dados, problemas } = validarDadosLote(req.body, true);
    if (problemas.length) return recusar(res, problemas);

    res.status(201).json(await servico.criarLote(id, setorId, a, dados));
  } catch (e) { tratar(res, e); }
});

router.patch("/:id/lotes/:loteId", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    const loteId = idDe(req, res, "loteId"); if (!loteId) return;

    const { dados, problemas } = validarDadosLote(req.body, false);
    if (problemas.length) return recusar(res, problemas);
    if (Object.keys(dados).length === 0) return erro(res, 400, "nada para alterar");

    res.json(await servico.editarLote(id, loteId, a, dados));
  } catch (e) { tratar(res, e); }
});

router.delete("/:id/lotes/:loteId", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;
    const loteId = idDe(req, res, "loteId"); if (!loteId) return;
    await servico.excluirLote(id, loteId, a);
    res.json({ removido: loteId });
  } catch (e) { tratar(res, e); }
});

// ================= cotação =================

/**
 * Quanto custaria esta compra? Não reserva nada. É o total que a tela de compra
 * mostra antes de confirmar, calculado pela Strategy de cada política de preço.
 */
router.post("/:id/cotacao", async (req, res) => {
  try {
    const a = exigir(req, res); if (!a) return;
    const id = idDe(req, res); if (!id) return;

    const itens = req.body?.itens;
    if (!Array.isArray(itens) || itens.length === 0) return erro(res, 400, "informe ao menos um item");
    if (itens.length > 20) return erro(res, 400, "no máximo 20 itens por cotação");

    const normalizados: servico.ItemCotacao[] = [];
    for (const it of itens) {
      if (!UUID_RE.test(it?.loteId)) return erro(res, 400, "loteId inválido");
      if (!Number.isInteger(it?.quantidade) || it.quantidade < 1 || it.quantidade > 20)
        return erro(res, 400, "quantidade deve ser um inteiro entre 1 e 20");
      const politica: PoliticaPreco = it.politica ?? "INTEIRA";
      if (!POLITICAS_PRECO.includes(politica))
        return erro(res, 400, `política deve ser uma de: ${POLITICAS_PRECO.join(", ")}`);
      normalizados.push({ loteId: it.loteId, quantidade: it.quantidade, politica });
    }

    res.json(await servico.cotar(id, normalizados));
  } catch (e) { tratar(res, e); }
});

