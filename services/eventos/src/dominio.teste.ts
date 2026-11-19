import { test } from "node:test";
import assert from "node:assert/strict";
import { EventoComposto, Lote, Setor } from "./estrutura";
import { TransicaoInvalida, estadoDe } from "./estados";
import { criadorPara, estrategiaPara } from "./precos";

/**
 * Testes do DOMÍNIO PURO: Composite, State e Strategy, sem banco e sem rede.
 *
 * Rodar:  npm run build && npm test
 *
 * São os três padrões GoF que o serviço de eventos carrega, e é aqui que se
 * comprova que eles funcionam — não só que compilam.
 */

const lote = (id: string, setorId: string, cap: number, res: number, preco = 10000) =>
  new Lote(id, setorId, `Lote ${id}`, preco, 20, "INTEIRA", cap, res, null, null, true);

// ---------------------------------------------------------------- COMPOSITE

test("Composite: a capacidade do evento é a soma dos setores, que é a soma dos lotes", () => {
  const pista = new Setor("s1", "e1", "Pista", null)
    .adicionar(lote("l1", "s1", 100, 10))
    .adicionar(lote("l2", "s1", 50, 5));
  const camarote = new Setor("s2", "e1", "Camarote", null)
    .adicionar(lote("l3", "s2", 20, 20));

  const evento = new EventoComposto("e1", "BGS").adicionar(pista).adicionar(camarote);

  assert.equal(pista.capacidade(), 150);
  assert.equal(pista.reservados(), 15);
  assert.equal(pista.disponiveis(), 135);

  assert.equal(camarote.disponiveis(), 0, "camarote esgotado");

  assert.equal(evento.capacidade(), 170, "100 + 50 + 20");
  assert.equal(evento.reservados(), 35, "10 + 5 + 20");
  assert.equal(evento.disponiveis(), 135);
});

test("Composite: evento sem setor, e setor sem lote, têm capacidade zero", () => {
  const vazio = new EventoComposto("e2", "Sem estrutura");
  assert.equal(vazio.capacidade(), 0);
  assert.equal(vazio.disponiveis(), 0);

  vazio.adicionar(new Setor("s9", "e2", "Setor vazio", null));
  assert.equal(vazio.capacidade(), 0, "um setor sem lote não cria lugares");
});

test("Composite: acharLote encontra em qualquer setor e o preço mínimo é o do evento", () => {
  const evento = new EventoComposto("e3", "CCXP")
    .adicionar(new Setor("s1", "e3", "Pista", null).adicionar(lote("l1", "s1", 10, 0, 25000)))
    .adicionar(new Setor("s2", "e3", "Arquibancada", null).adicionar(lote("l2", "s2", 10, 0, 9000)));

  assert.equal(evento.acharLote("l2")?.nome, "Lote l2");
  assert.equal(evento.acharLote("inexistente"), null);
  assert.equal(evento.precoMinimo(), 9000, "o menor preço vigente do evento");
});

test("Composite: lote esgotado some do preço mínimo", () => {
  const evento = new EventoComposto("e4", "Arena")
    .adicionar(new Setor("s1", "e4", "Pista", null)
      .adicionar(lote("barato", "s1", 10, 10, 5000))   // esgotado
      .adicionar(lote("caro", "s1", 10, 0, 20000)));

  assert.equal(evento.precoMinimo(), 20000, "o lote esgotado não vale como preço a partir de");
});

test("Composite: lote fora da janela de vigência não vende", () => {
  const ontem = new Date(Date.now() - 86_400_000);
  const anteontem = new Date(Date.now() - 2 * 86_400_000);
  const encerrado = new Lote("l", "s", "Pré-venda", 5000, 0, "INTEIRA", 10, 0, anteontem, ontem, true);
  const desligado = new Lote("l2", "s", "Desligado", 5000, 0, "INTEIRA", 10, 0, null, null, false);

  assert.equal(encerrado.vigente(), false, "fora da janela");
  assert.equal(desligado.vigente(), false, "lote inativo");
  assert.equal(encerrado.disponiveis(), 10, "ainda tem lugar, mas não está vigente");
});

// -------------------------------------------------------------------- STATE

test("State: o caminho feliz do evento vai de RASCUNHO a REALIZADO", () => {
  let e = estadoDe("RASCUNHO");
  assert.equal(e.visivelNoCatalogo(), false, "rascunho não aparece no catálogo");
  assert.equal(e.aceitaVendas(), false);

  e = e.publicar();
  assert.equal(e.nome, "PUBLICADO");
  assert.equal(e.aceitaVendas(), false, "publicado ainda não vende");

  e = e.abrirVendas();
  assert.equal(e.nome, "VENDAS_ABERTAS");
  assert.equal(e.aceitaVendas(), true, "só aqui se reserva lugar");

  e = e.encerrarVendas();
  assert.equal(e.nome, "VENDAS_ENCERRADAS");
  assert.equal(e.aceitaVendas(), false);

  e = e.realizar();
  assert.equal(e.nome, "REALIZADO");
});

test("State: transições fora de ordem são recusadas", () => {
  assert.throws(() => estadoDe("RASCUNHO").abrirVendas(), TransicaoInvalida,
    "não se abre venda sem publicar");
  assert.throws(() => estadoDe("PUBLICADO").publicar(), TransicaoInvalida,
    "não se publica duas vezes");
  assert.throws(() => estadoDe("REALIZADO").cancelar(), TransicaoInvalida,
    "evento realizado não é cancelado");
  assert.throws(() => estadoDe("CANCELADO").abrirVendas(), TransicaoInvalida,
    "evento cancelado não volta a vender");
});

test("State: cancelar vale de qualquer estado anterior ao fim", () => {
  for (const s of ["RASCUNHO", "PUBLICADO", "VENDAS_ABERTAS", "VENDAS_ENCERRADAS"] as const) {
    assert.equal(estadoDe(s).cancelar().nome, "CANCELADO", `deveria cancelar a partir de ${s}`);
  }
});

test("State: só rascunho e publicado podem ser excluídos", () => {
  assert.equal(estadoDe("RASCUNHO").permiteExclusao(), true);
  assert.equal(estadoDe("PUBLICADO").permiteExclusao(), true);
  assert.equal(estadoDe("VENDAS_ABERTAS").permiteExclusao(), false);
  assert.equal(estadoDe("REALIZADO").permiteExclusao(), false);
});

test("State: estrutura e dados têm janelas de edição diferentes", () => {
  assert.equal(estadoDe("VENDAS_ABERTAS").aceitaEdicaoEstrutura(), true, "dá para somar um lote novo");
  assert.equal(estadoDe("VENDAS_ENCERRADAS").aceitaEdicaoEstrutura(), false);
  assert.equal(estadoDe("VENDAS_ENCERRADAS").aceitaEdicaoDados(), true, "mudança de local de última hora");
  assert.equal(estadoDe("REALIZADO").aceitaEdicaoDados(), false);
});

// ----------------------------------------------------- STRATEGY + FACTORY METHOD

test("Strategy: cada política calcula o seu preço", () => {
  const base = 10000;        // R$ 100,00
  const desconto = 20;       // usado só pela promocional

  assert.equal(estrategiaPara("INTEIRA").precoUnitario(base, desconto), 10000);
  assert.equal(estrategiaPara("MEIA").precoUnitario(base, desconto), 5000);
  assert.equal(estrategiaPara("PROMOCIONAL").precoUnitario(base, desconto), 8000);
  assert.equal(estrategiaPara("CORTESIA").precoUnitario(base, desconto), 0);
});

test("Strategy: o arredondamento é ao centavo e nunca gera preço negativo", () => {
  assert.equal(estrategiaPara("MEIA").precoUnitario(2501, 0), 1251, "2501/2 = 1250,5 arredonda para 1251");
  assert.equal(estrategiaPara("PROMOCIONAL").precoUnitario(10000, 150), 0, "desconto é limitado a 100%");
  assert.equal(estrategiaPara("PROMOCIONAL").precoUnitario(10000, -10), 10000, "desconto negativo vira 0%");
});

test("Factory Method: cada criador devolve a estratégia da sua política", () => {
  for (const p of ["INTEIRA", "MEIA", "PROMOCIONAL", "CORTESIA"] as const) {
    assert.equal(criadorPara(p).criarEstrategia().nome, p);
  }
});

test("Strategy aplicada ao lote: o mesmo lote tem preços diferentes por política", () => {
  const l = new Lote("l", "s", "Pista", 10000, 20, "INTEIRA", 100, 0, null, null, true);

  assert.equal(l.precoUnitario(), 10000, "a política padrão do lote é INTEIRA");
  assert.equal(l.precoUnitario("MEIA"), 5000);
  assert.equal(l.precoUnitario("PROMOCIONAL"), 8000, "aplica os 20% do lote");
  assert.equal(l.precoUnitario("CORTESIA"), 0);
});
