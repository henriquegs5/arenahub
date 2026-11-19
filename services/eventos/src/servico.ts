import { PoolClient } from "pg";
import { Autor } from "./auth";
import { pool } from "./db";
import { estadoDe } from "./estados";
import { EventoComposto, Lote } from "./estrutura";
import { PoliticaPreco, emReais } from "./precos";
import { EventoSaida, transacao, transacaoCom } from "./outbox";
import * as repo from "./repositorio";

export class ErroNegocio extends Error {
  constructor(public readonly status: number, mensagem: string) {
    super(mensagem);
    this.name = "ErroNegocio";
  }
}

/** Só o organizador dono do evento, ou o ADM, mexe no evento. */
async function eventoSobControle(c: PoolClient, id: string, a: Autor): Promise<repo.Evento> {
  const e = await repo.buscarEvento(id, c, true);
  if (!e) throw new ErroNegocio(404, "evento não encontrado");
  if (a.papel !== "ADM" && e.organizadorId !== a.id)
    throw new ErroNegocio(403, "somente o organizador do evento pode fazer isso");
  return e;
}

// ================= ciclo de vida do evento (State) =================

export function publicar(id: string, a: Autor) {
  return transacaoCom(async (c) => {
    const e = await eventoSobControle(c, id, a);
    const proximo = estadoDe(e.status).publicar();

    // Publicar um evento sem lugar nenhum enganaria o participante.
    const arvore = await repo.carregarEstrutura(c, e);
    if (arvore.capacidade() <= 0)
      throw new ErroNegocio(409, "crie ao menos um setor com um lote antes de publicar");

    await repo.atualizarStatus(c, id, proximo.nome);
    return { valor: proximo.nome, eventos: [] as EventoSaida[] };
  });
}

export function abrirVendas(id: string, a: Autor) {
  return transacaoCom(async (c) => {
    const e = await eventoSobControle(c, id, a);
    const proximo = estadoDe(e.status).abrirVendas();
    await repo.atualizarStatus(c, id, proximo.nome);
    return { valor: proximo.nome, eventos: [] as EventoSaida[] };
  });
}

export function encerrarVendas(id: string, a: Autor) {
  return transacaoCom(async (c) => {
    const e = await eventoSobControle(c, id, a);
    const proximo = estadoDe(e.status).encerrarVendas();
    await repo.atualizarStatus(c, id, proximo.nome);
    return { valor: proximo.nome, eventos: [] as EventoSaida[] };
  });
}

export function realizar(id: string, a: Autor) {
  return transacaoCom(async (c) => {
    const e = await eventoSobControle(c, id, a);
    const proximo = estadoDe(e.status).realizar();
    await repo.atualizarStatus(c, id, proximo.nome);
    return { valor: proximo.nome, eventos: [] as EventoSaida[] };
  });
}

/**
 * Cancelamento do evento. Publica `evento.cancelado`, que inicia a cadeia de
 * compensação: Ingressos invalida os ingressos e pede o estorno, Pagamento
 * estorna e Notificações avisa todos os compradores (lotes 3 e 5).
 *
 * Quem sabe QUEM comprou é o serviço de Ingressos, não este. Por isso este
 * evento sai sem `destinatarios`: o serviço de Ingressos, que conhece os
 * titulares, é quem publica o aviso nominal. Consultar outro serviço por HTTP
 * para descobrir os compradores acoplaria os dois.
 */
export function cancelar(id: string, a: Autor, motivo: string, correlationId: string) {
  return transacaoCom(async (c) => {
    const e = await eventoSobControle(c, id, a);
    const proximo = estadoDe(e.status).cancelar();
    await repo.atualizarStatus(c, id, proximo.nome, motivo);

    return {
      valor: proximo.nome,
      eventos: [{
        nome: "evento.cancelado",
        correlationId,
        payload: {
          eventoId: e.id,
          nome: e.nome,
          dataHora: e.dataHora.toISOString(),
          local: e.local,
          motivo,
          organizadorId: e.organizadorId,
          destinatarios: [] as string[],
        },
      }],
    };
  });
}

// ================= dados do evento =================

export function criar(d: repo.DadosEvento, a: Autor) {
  return repo.criarEvento(d, a.id);
}

/**
 * Edição dos dados do evento. Mudança de NOME, DATA ou LOCAL é "atualização de
 * última hora" e publica `evento.alterado`; mudar só a descrição não incomoda
 * ninguém e não gera aviso.
 */
export function editar(id: string, a: Autor, d: Partial<repo.DadosEvento>, correlationId: string) {
  return transacaoCom(async (c) => {
    const e = await eventoSobControle(c, id, a);
    if (!estadoDe(e.status).aceitaEdicaoDados())
      throw new ErroNegocio(409, `não é possível editar um evento em ${e.status}`);

    const alteracoes: string[] = [];
    if (d.nome !== undefined && d.nome !== e.nome) alteracoes.push("nome");
    if (d.local !== undefined && d.local !== e.local) alteracoes.push("local");
    if (d.dataHora !== undefined && d.dataHora.getTime() !== e.dataHora.getTime()) alteracoes.push("data");

    await repo.atualizarEvento(c, id, d);
    const atualizado = (await repo.buscarEvento(id, c))!;

    const eventos: EventoSaida[] = alteracoes.length === 0 ? [] : [{
      nome: "evento.alterado",
      correlationId,
      payload: {
        eventoId: atualizado.id,
        nome: atualizado.nome,
        dataHora: atualizado.dataHora.toISOString(),
        local: atualizado.local,
        alteracoes,
        organizadorId: atualizado.organizadorId,
        destinatarios: [] as string[],
      },
    }];

    return { valor: atualizado, eventos };
  });
}

/**
 * Exclusão definitiva. Só é permitida enquanto NINGUÉM comprou: depois disso, o
 * caminho correto é cancelar, que estorna e avisa os compradores. Apagar um
 * evento com ingressos vendidos deixaria ingresso órfão e dinheiro sem dono.
 */
export function excluir(id: string, a: Autor) {
  return transacao(async (c) => {
    const e = await eventoSobControle(c, id, a);
    if (!estadoDe(e.status).permiteExclusao())
      throw new ErroNegocio(409, `um evento em ${e.status} não pode ser excluído; cancele-o`);

    const arvore = await repo.carregarEstrutura(c, e);
    if (arvore.reservados() > 0)
      throw new ErroNegocio(409, "este evento já tem lugares vendidos; cancele o evento em vez de excluí-lo");

    await repo.removerEvento(c, id); // setores e lotes caem em cascata
    return [];
  });
}

// ================= setores e lotes (Composite) =================

async function estruturaEditavel(c: PoolClient, eventoId: string, a: Autor): Promise<repo.Evento> {
  const e = await eventoSobControle(c, eventoId, a);
  if (!estadoDe(e.status).aceitaEdicaoEstrutura())
    throw new ErroNegocio(409, `não é possível alterar setores e lotes de um evento em ${e.status}`);
  return e;
}

export function criarSetor(eventoId: string, a: Autor, nome: string, descricao: string | null) {
  return transacaoCom(async (c) => {
    await estruturaEditavel(c, eventoId, a);
    return { valor: await repo.criarSetor(c, eventoId, nome, descricao), eventos: [] as EventoSaida[] };
  });
}

export function editarSetor(
  eventoId: string, setorId: string, a: Autor, nome?: string, descricao?: string | null
) {
  return transacaoCom(async (c) => {
    await estruturaEditavel(c, eventoId, a);
    const s = await repo.setorDoEvento(c, setorId, eventoId);
    if (!s) throw new ErroNegocio(404, "setor não encontrado neste evento");
    await repo.atualizarSetor(c, setorId, nome, descricao);
    return { valor: (await repo.buscarSetor(c, setorId))!, eventos: [] as EventoSaida[] };
  });
}

export function excluirSetor(eventoId: string, setorId: string, a: Autor) {
  return transacao(async (c) => {
    const e = await estruturaEditavel(c, eventoId, a);
    const s = await repo.setorDoEvento(c, setorId, eventoId);
    if (!s) throw new ErroNegocio(404, "setor não encontrado neste evento");

    // Excluir um setor com lugares vendidos apagaria ingressos já pagos.
    const arvore = await repo.carregarEstrutura(c, e);
    const setor = arvore.filhos().find((x) => x.id === setorId);
    if (setor && setor.reservados() > 0)
      throw new ErroNegocio(409, "este setor já tem lugares vendidos e não pode ser excluído");

    await repo.removerSetor(c, setorId);
    return [];
  });
}

export function criarLote(eventoId: string, setorId: string, a: Autor, d: repo.DadosLote) {
  return transacaoCom(async (c) => {
    await estruturaEditavel(c, eventoId, a);
    const s = await repo.setorDoEvento(c, setorId, eventoId);
    if (!s) throw new ErroNegocio(404, "setor não encontrado neste evento");
    return { valor: await repo.criarLote(c, setorId, d), eventos: [] as EventoSaida[] };
  });
}

export function editarLote(eventoId: string, loteId: string, a: Autor, d: Partial<repo.DadosLote>) {
  return transacaoCom(async (c) => {
    await estruturaEditavel(c, eventoId, a);
    if ((await repo.eventoDoLote(c, loteId)) !== eventoId)
      throw new ErroNegocio(404, "lote não encontrado neste evento");

    const lote = await repo.buscarLote(c, loteId, true);
    if (!lote) throw new ErroNegocio(404, "lote não encontrado");

    // Reduzir a capacidade abaixo do que já saiu deixaria o lote estourado.
    if (d.capacidade !== undefined && d.capacidade < lote.reservados())
      throw new ErroNegocio(409,
        `a capacidade não pode ficar abaixo dos ${lote.reservados()} lugares já vendidos`);

    await repo.atualizarLote(c, loteId, d);
    return { valor: (await repo.buscarLote(c, loteId))!, eventos: [] as EventoSaida[] };
  });
}

export function excluirLote(eventoId: string, loteId: string, a: Autor) {
  return transacao(async (c) => {
    await estruturaEditavel(c, eventoId, a);
    if ((await repo.eventoDoLote(c, loteId)) !== eventoId)
      throw new ErroNegocio(404, "lote não encontrado neste evento");

    const lote = await repo.buscarLote(c, loteId, true);
    if (!lote) throw new ErroNegocio(404, "lote não encontrado");
    if (lote.reservados() > 0)
      throw new ErroNegocio(409, "este lote já tem lugares vendidos e não pode ser excluído");

    await repo.removerLote(c, loteId);
    return [];
  });
}

// ================= cotação (Strategy) =================

export interface ItemCotacao { loteId: string; quantidade: number; politica: PoliticaPreco }

export interface LinhaCotacao {
  loteId: string; loteNome: string; setorNome: string;
  quantidade: number; politica: PoliticaPreco;
  precoUnitarioCentavos: number; subtotalCentavos: number;
}

export interface Cotacao {
  eventoId: string; eventoNome: string;
  itens: LinhaCotacao[];
  totalCentavos: number; total: string;
}

/**
 * Calcula quanto custaria uma compra, SEM reservar nada. É o que a tela de
 * compra mostra antes de confirmar. O preço de cada linha sai da STRATEGY da
 * política escolhida, aplicada sobre o preço do lote.
 */
export async function cotar(eventoId: string, itens: ItemCotacao[]): Promise<Cotacao> {
  const e = await repo.buscarEvento(eventoId);
  if (!e) throw new ErroNegocio(404, "evento não encontrado");
  const arvore = await repo.carregarEstrutura(pool, e);
  return montarCotacao(e, arvore, itens);
}

/** Separado para poder ser usado dentro de uma transação da Saga (lote 3). */
export function montarCotacao(
  e: { id: string; nome: string }, arvore: EventoComposto, itens: ItemCotacao[]
): Cotacao {
  const agora = new Date();
  const linhas: LinhaCotacao[] = itens.map((item) => {
    const lote = arvore.acharLote(item.loteId);
    if (!lote) throw new ErroNegocio(404, `lote ${item.loteId} não pertence a este evento`);
    if (!lote.vigente(agora)) throw new ErroNegocio(409, `o lote "${lote.nome}" não está vigente`);

    const setor = arvore.filhos().find((s) => s.filhos().some((l) => l.id === lote.id))!;
    const unitario = lote.precoUnitario(item.politica);
    return {
      loteId: lote.id,
      loteNome: lote.nome,
      setorNome: setor.nome,
      quantidade: item.quantidade,
      politica: item.politica,
      precoUnitarioCentavos: unitario,
      subtotalCentavos: unitario * item.quantidade,
    };
  });

  const totalCentavos = linhas.reduce((t, l) => t + l.subtotalCentavos, 0);
  return { eventoId: e.id, eventoNome: e.nome, itens: linhas, totalCentavos, total: emReais(totalCentavos) };
}

// ================= reserva e liberação (usadas pela Saga, lote 3) =================

export interface PedidoReserva { loteId: string; quantidade: number; politica: PoliticaPreco }

export interface ResultadoReserva {
  ok: boolean;
  motivo?: string;
  cotacao?: Cotacao;
}

/**
 * Reserva os lugares de uma compra. Passo 2 da SAGA DA COMPRA.
 *
 * Tudo numa transação só: ou todos os itens são reservados, ou nenhum. Se um
 * item não couber, o ROLLBACK desfaz os anteriores e a resposta é uma recusa
 * limpa — não fica lugar preso sem pedido.
 */
export async function reservar(eventoId: string, itens: PedidoReserva[]): Promise<ResultadoReserva> {
  try {
    return await transacaoCom<ResultadoReserva>(async (c) => {
      const e = await repo.buscarEvento(eventoId, c, true);
      if (!e) return { valor: { ok: false, motivo: "evento não encontrado" }, eventos: [] };
      if (!estadoDe(e.status).aceitaVendas())
        return { valor: { ok: false, motivo: `as vendas deste evento não estão abertas (${e.status})` }, eventos: [] };

      const arvore = await repo.carregarEstrutura(c, e);
      const cotacao = montarCotacao(e, arvore, itens);

      for (const item of itens) {
        if (!(await repo.reservarLugares(c, item.loteId, item.quantidade))) {
          const lote = arvore.acharLote(item.loteId);
          throw new RecusaReserva(
            `não há ${item.quantidade} lugar(es) disponível(is) no lote "${lote?.nome ?? item.loteId}"`
          );
        }
      }

      return { valor: { ok: true, cotacao }, eventos: [] };
    });
  } catch (err) {
    if (err instanceof RecusaReserva) return { ok: false, motivo: err.message };
    if (err instanceof ErroNegocio) return { ok: false, motivo: err.message };
    throw err;
  }
}

/** Recusa esperada: faz ROLLBACK da reserva inteira sem virar erro 500. */
class RecusaReserva extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = "RecusaReserva"; }
}

/**
 * Devolve os lugares ao estoque. COMPENSAÇÃO da Saga, usada quando o pagamento
 * é recusado, o pedido expira ou o comprador cancela.
 */
export function liberar(itens: { loteId: string; quantidade: number }[]) {
  return transacao(async (c) => {
    for (const item of itens) await repo.liberarLugares(c, item.loteId, item.quantidade);
    return [];
  });
}

// ================= leitura para a API =================

export interface EventoDetalhado {
  id: string; nome: string; descricao: string | null; dataHora: string; local: string;
  status: string; organizadorId: string; motivoCancelamento: string | null;
  capacidade: number; reservados: number; disponiveis: number;
  precoMinimoCentavos: number | null;
  setores: {
    id: string; nome: string; descricao: string | null;
    capacidade: number; reservados: number; disponiveis: number;
    lotes: {
      id: string; nome: string; precoCentavos: number; precoFormatado: string;
      descontoPercentual: number; politicaPadrao: string;
      capacidade: number; reservados: number; disponiveis: number;
      inicioVendas: string | null; fimVendas: string | null; ativo: boolean; vigente: boolean;
    }[];
  }[];
}

/** Monta a resposta do detalhe percorrendo o Composite uma única vez. */
export function detalhar(e: repo.Evento, arvore: EventoComposto): EventoDetalhado {
  const agora = new Date();
  return {
    id: e.id,
    nome: e.nome,
    descricao: e.descricao,
    dataHora: e.dataHora.toISOString(),
    local: e.local,
    status: e.status,
    organizadorId: e.organizadorId,
    motivoCancelamento: e.motivoCancelamento,
    capacidade: arvore.capacidade(),
    reservados: arvore.reservados(),
    disponiveis: arvore.disponiveis(),
    precoMinimoCentavos: arvore.precoMinimo(agora),
    setores: arvore.filhos().map((s) => ({
      id: s.id,
      nome: s.nome,
      descricao: s.descricao,
      capacidade: s.capacidade(),
      reservados: s.reservados(),
      disponiveis: s.disponiveis(),
      lotes: s.filhos().map((l: Lote) => ({
        id: l.id,
        nome: l.nome,
        precoCentavos: l.precoCentavos,
        precoFormatado: emReais(l.precoUnitario()),
        descontoPercentual: l.descontoPercentual,
        politicaPadrao: l.politicaPadrao,
        capacidade: l.capacidade(),
        reservados: l.reservados(),
        disponiveis: l.disponiveis(),
        inicioVendas: l.inicioVendas ? new Date(l.inicioVendas).toISOString() : null,
        fimVendas: l.fimVendas ? new Date(l.fimVendas).toISOString() : null,
        ativo: l.ativo,
        vigente: l.vigente(agora),
      })),
    })),
  };
}
