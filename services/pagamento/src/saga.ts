import { pool } from "./db";
import { EventEnvelope } from "./messaging";
import { EventoSaida, transacao } from "./outbox";
import { MeioPagamento, emReais, estrategiaPara, meioValido } from "./meios";
import { ProvedorPagamento, ProvedorSimuladoAdapter, mascararReferencia } from "./provedor";
import * as repo from "./repositorio";

/**
 * SAGA DA COMPRA — o que cabe ao serviço de PAGAMENTO.
 *
 *   Ingressos --pagamento.solicitado--> [AQUI] --pagamento.aprovado--> Ingressos
 *                                              --pagamento.recusado--> Ingressos
 *   Ingressos --estorno.solicitado----> [AQUI] --estorno.concluido---> Ingressos
 *
 * IDEMPOTÊNCIA (duas camadas):
 *  1. `eventos_processados` descarta a reentrega do mesmo evento.
 *  2. `transacoes.pedido_id` é ÚNICO. É a defesa que importa: se a primeira
 *     camada falhar, o banco impede cobrar o mesmo pedido duas vezes, e o
 *     tratamento republica o desfecho que já havia sido decidido.
 */

/** O provedor é injetável para poder ser trocado (Adapter). */
const provedor: ProvedorPagamento = new ProvedorSimuladoAdapter();

async function idempotente(evento: EventEnvelope, fn: () => Promise<void>): Promise<void> {
  if (!(await repo.marcarProcessado(evento.eventId))) return;
  try {
    await fn();
  } catch (e) {
    await repo.desmarcarProcessado(evento.eventId);
    throw e;
  }
}

interface PayloadPagamentoSolicitado {
  pedidoId: string;
  eventoId: string;
  compradorId: string;
  valorCentavos: number;
  meio: string;
  referenciaPagamento: string;
  eventoNome: string;
}

/** Monta o par de eventos de desfecho a partir de uma transação já gravada. */
function desfecho(t: repo.Transacao, p: PayloadPagamentoSolicitado, correlationId: string): EventoSaida {
  if (t.status === "APROVADO") {
    return {
      nome: "pagamento.aprovado",
      correlationId,
      payload: {
        pedidoId: t.pedidoId,
        transacaoId: t.id,
        eventoId: p.eventoId,
        compradorId: t.compradorId,
        valorCentavos: t.valorCentavos,
        meio: t.meio,
        autorizacao: t.autorizacao,
        destinatarios: [] as string[],
      },
    };
  }
  return {
    nome: "pagamento.recusado",
    correlationId,
    payload: {
      pedidoId: t.pedidoId,
      transacaoId: t.id,
      eventoId: p.eventoId,
      compradorId: t.compradorId,
      valorCentavos: t.valorCentavos,
      meio: t.meio,
      motivo: t.motivo ?? "pagamento não autorizado",
      eventoNome: p.eventoNome,
      // O comprador precisa saber que a compra não foi adiante.
      destinatarios: [t.compradorId],
    },
  };
}

/**
 * Passo 4 da Saga: processa a cobrança e anuncia o desfecho.
 *
 * A chamada ao provedor acontece FORA da transação do banco: uma chamada externa
 * presa dentro de uma transação a manteria aberta pelo tempo da rede. O que a
 * transação grava é o resultado, junto com o evento na outbox.
 */
export function tratarPagamentoSolicitado(evento: EventEnvelope<PayloadPagamentoSolicitado>) {
  return idempotente(evento, async () => {
    const p = evento.payload;
    const correlationId = evento.correlationId;

    // Reentrega tardia: a transação já existe, então só republica o desfecho.
    const existente = await repo.buscarPorPedido(pool, p.pedidoId);
    if (existente) {
      console.log(`[pagamento] pedido ${p.pedidoId} já processado (${existente.status}); republicando o desfecho`);
      await transacao(async () => [desfecho(existente, p, correlationId)]);
      return;
    }

    const meio: MeioPagamento = meioValido(p.meio) ? p.meio : "CARTAO_CREDITO";
    const referencia = p.referenciaPagamento || "tok_sem_referencia";

    const resultado = await provedor.cobrar({
      pedidoId: p.pedidoId,
      valorCentavos: p.valorCentavos,
      meio,
      referenciaPagamento: referencia,
    });

    console.log(
      `[pagamento] pedido ${p.pedidoId} ${resultado.aprovado ? "APROVADO" : "RECUSADO"} ` +
      `valor=${emReais(p.valorCentavos)} meio=${estrategiaPara(meio).rotulo} ` +
      `ref=${mascararReferencia(referencia)}` +
      (resultado.motivo ? ` motivo="${resultado.motivo}"` : "")
    );

    await transacao(async (c) => {
      let t: repo.Transacao;
      try {
        t = await repo.registrar(c, {
          pedidoId: p.pedidoId,
          compradorId: p.compradorId,
          valorCentavos: p.valorCentavos,
          meio,
          referenciaPagamento: referencia,
          status: resultado.aprovado ? "APROVADO" : "RECUSADO",
          identificadorExterno: resultado.identificadorExterno,
          autorizacao: resultado.autorizacao,
          motivo: resultado.motivo,
        });
      } catch (e: any) {
        // Corrida: outro consumidor gravou primeiro. Vale o que está no banco.
        if (e?.code !== "23505") throw e;
        t = (await repo.buscarPorPedido(c, p.pedidoId, true))!;
      }
      return [desfecho(t, p, correlationId)];
    });
  });
}

interface PayloadEstornoSolicitado {
  pedidoId: string;
  eventoId: string;
  compradorId: string;
  motivo: string;
  eventoNome: string;
}

/**
 * COMPENSAÇÃO: estorna a cobrança de um pedido cancelado ou de um evento
 * cancelado.
 *
 * Idempotente: uma transação já ESTORNADA não é estornada de novo, e um pedido
 * que nunca foi cobrado (ou cuja cobrança foi RECUSADA) não gera estorno — nos
 * dois casos o serviço confirma o desfecho em vez de inventar um movimento.
 */
export function tratarEstornoSolicitado(evento: EventEnvelope<PayloadEstornoSolicitado>) {
  return idempotente(evento, async () => {
    const p = evento.payload;
    const correlationId = evento.correlationId;

    const t = await repo.buscarPorPedido(pool, p.pedidoId);

    if (!t || t.status === "RECUSADO") {
      console.log(`[pagamento] estorno do pedido ${p.pedidoId} dispensado: não há cobrança aprovada`);
      return;
    }

    if (t.status === "ESTORNADO") {
      console.log(`[pagamento] pedido ${p.pedidoId} já estava estornado; republicando a confirmação`);
      await transacao(async () => [eventoEstorno(t, p, correlationId, true)]);
      return;
    }

    const resultado = await provedor.estornar(t.identificadorExterno ?? t.id, t.meio);

    if (!resultado.estornado) {
      // Meio que não estorna sozinho (boleto): fica registrado para o ADM tratar.
      console.warn(`[pagamento] estorno do pedido ${p.pedidoId} NÃO automático: ${resultado.motivo}`);
      await transacao(async () => [{
        nome: "estorno.concluido",
        correlationId,
        payload: {
          pedidoId: t.pedidoId,
          transacaoId: t.id,
          eventoId: p.eventoId,
          compradorId: t.compradorId,
          valorCentavos: t.valorCentavos,
          automatico: false,
          motivo: resultado.motivo ?? "estorno manual",
          eventoNome: p.eventoNome,
          destinatarios: [t.compradorId],
        },
      }]);
      return;
    }

    await transacao(async (c) => {
      const atual = await repo.buscarPorPedido(c, p.pedidoId, true);
      if (!atual || atual.status === "ESTORNADO") return [];
      await repo.marcarEstornada(c, atual.id, p.motivo);
      console.log(`[pagamento] pedido ${p.pedidoId} estornado: ${emReais(atual.valorCentavos)}`);
      return [eventoEstorno(atual, p, correlationId, true)];
    });
  });
}

function eventoEstorno(
  t: repo.Transacao, p: PayloadEstornoSolicitado, correlationId: string, automatico: boolean
): EventoSaida {
  return {
    nome: "estorno.concluido",
    correlationId,
    payload: {
      pedidoId: t.pedidoId,
      transacaoId: t.id,
      eventoId: p.eventoId,
      compradorId: t.compradorId,
      valorCentavos: t.valorCentavos,
      automatico,
      motivo: p.motivo,
      eventoNome: p.eventoNome,
      destinatarios: [t.compradorId],
    },
  };
}
