import { EventEnvelope } from "./messaging";
import { EventoSaida, transacao, transacaoCom } from "./outbox";
import { montarCotacao } from "./servico";
import { cadeiaDeReserva, ItemPedido } from "./validacoes";
import * as repo from "./repositorio";

/**
 * SAGA DA COMPRA — o que cabe ao serviço de EVENTOS.
 *
 *   Ingressos  --compra.solicitada-->  [AQUI]  --lugares.reservados--> Ingressos
 *                                              --reserva.recusada----> Ingressos
 *
 *   Ingressos  --pedido.cancelado--->  [AQUI]  --lugares.liberados---> (compensação)
 *   Eventos    --evento.cancelado--->  [AQUI]  libera tudo do evento
 *
 * IDEMPOTÊNCIA (duas camadas):
 *  1. `eventos_processados` descarta a reentrega do MESMO evento pelo broker.
 *  2. A tabela `reservas` guarda o estado por PEDIDO. É ela que protege contra o
 *     caso mais perigoso: liberar lugares que nunca foram reservados, ou liberar
 *     duas vezes. Um decremento cego em `lotes.reservados` corromperia o estoque.
 */

/** Marca o evento como processado antes de agir; desmarca se o tratamento falhar. */
async function idempotente(evento: EventEnvelope, fn: () => Promise<void>): Promise<void> {
  if (!(await repo.marcarProcessado(evento.eventId))) return;
  try {
    await fn();
  } catch (e) {
    await repo.desmarcarProcessado(evento.eventId);
    throw e;
  }
}

interface PayloadCompraSolicitada {
  pedidoId: string;
  eventoId: string;
  compradorId: string;
  itens: ItemPedido[];
}

/** Recusa esperada: faz ROLLBACK da reserva inteira sem virar erro 500. */
class Recusa extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = "Recusa"; }
}

/**
 * Passo 2 da Saga: verifica a disponibilidade e RESERVA os lugares.
 *
 * Ou todos os itens entram, ou nenhum: um item que não couber lança Recusa e o
 * ROLLBACK desfaz os anteriores, então não fica lugar preso sem pedido.
 */
export function tratarCompraSolicitada(evento: EventEnvelope<PayloadCompraSolicitada>) {
  return idempotente(evento, async () => {
    const { pedidoId, eventoId, compradorId, itens } = evento.payload;
    const correlationId = evento.correlationId;

    let recusa: string | null = null;

    try {
      await transacao(async (c) => {
        // Reentrega tardia do mesmo pedido: já reservado, nada a fazer de novo.
        const jaReservado = await repo.buscarReserva(c, pedidoId, true);
        if (jaReservado) {
          console.log(`[eventos] pedido ${pedidoId} já tinha reserva (${jaReservado.status}); nada a refazer`);
          return [];
        }

        const e = await repo.buscarEvento(eventoId, c, true);
        if (!e) throw new Recusa("evento não encontrado");

        const arvore = await repo.carregarEstrutura(c, e);

        // CHAIN OF RESPONSIBILITY: o primeiro elo que recusar interrompe.
        const motivo = cadeiaDeReserva().verificar({ evento: e, arvore, itens, agora: new Date() });
        if (motivo) throw new Recusa(motivo);

        // Preço calculado aqui, onde moram os dados de preço (Strategy).
        const cotacao = montarCotacao(e, arvore, itens);

        // Reserva atômica, item a item. O UPDATE carrega a condição de capacidade.
        for (const item of itens) {
          if (!(await repo.reservarLugares(c, item.loteId, item.quantidade))) {
            const lote = arvore.acharLote(item.loteId);
            throw new Recusa(`os lugares do lote "${lote?.nome ?? item.loteId}" acabaram de esgotar`);
          }
        }

        await repo.criarReserva(
          c, pedidoId, eventoId,
          itens.map((i) => ({ loteId: i.loteId, quantidade: i.quantidade })),
          cotacao.totalCentavos
        );

        return [{
          nome: "lugares.reservados",
          correlationId,
          payload: {
            pedidoId,
            eventoId,
            compradorId,
            // Dono do evento: Ingressos guarda a copia para saber quem valida na
            // entrada, sem consultar Eventos.
            organizadorId: e.organizadorId,
            eventoNome: e.nome,
            eventoDataHora: e.dataHora.toISOString(),
            eventoLocal: e.local,
            itens: cotacao.itens.map((l) => ({
              loteId: l.loteId,
              setorNome: l.setorNome,
              loteNome: l.loteNome,
              quantidade: l.quantidade,
              politica: l.politica,
              precoUnitarioCentavos: l.precoUnitarioCentavos,
            })),
            totalCentavos: cotacao.totalCentavos,
            destinatarios: [] as string[],
          },
        }];
      });
    } catch (err) {
      if (!(err instanceof Recusa)) throw err;
      recusa = err.message;
    }

    // Recusa em transação própria: a de cima sofreu ROLLBACK e nada foi reservado.
    if (recusa !== null) {
      const e = await repo.buscarEvento(eventoId);
      await transacao(async () => [{
        nome: "reserva.recusada",
        correlationId,
        payload: {
          pedidoId,
          eventoId,
          compradorId,
          eventoNome: e?.nome ?? "evento",
          motivo: recusa!,
          destinatarios: [] as string[],
        },
      }]);
      console.log(`[eventos] reserva do pedido ${pedidoId} recusada: ${recusa}`);
    }
  });
}

interface PayloadPedidoCancelado {
  pedidoId: string;
  eventoId: string;
  compradorId: string;
  motivo: string;
}

/**
 * COMPENSAÇÃO: devolve ao estoque os lugares de um pedido que não vingou —
 * pagamento recusado, pedido expirado ou cancelamento do comprador.
 *
 * É idempotente de verdade: só age sobre uma reserva ATIVA. Reentrega do evento,
 * pedido que expirou antes de reservar e compensação repetida resultam todos em
 * nada, em vez de devolver lugares que não saíram.
 */
export function tratarPedidoCancelado(evento: EventEnvelope<PayloadPedidoCancelado>) {
  return idempotente(evento, () => transacaoCom(async (c) => {
    const { pedidoId, motivo } = evento.payload;

    const reserva = await repo.buscarReserva(c, pedidoId, true);
    if (!reserva) {
      console.log(`[eventos] pedido ${pedidoId} cancelado sem reserva registrada; nada a liberar`);
      return { valor: undefined as void, eventos: [] as EventoSaida[] };
    }
    if (reserva.status !== "ATIVA") {
      console.log(`[eventos] reserva do pedido ${pedidoId} já estava ${reserva.status}; nada a liberar`);
      return { valor: undefined as void, eventos: [] as EventoSaida[] };
    }

    for (const item of reserva.itens) {
      await repo.liberarLugares(c, item.loteId, item.quantidade);
    }
    await repo.marcarReservaLiberada(c, pedidoId);

    console.log(`[eventos] lugares do pedido ${pedidoId} liberados (${motivo})`);

    return {
      valor: undefined as void,
      eventos: [{
        nome: "lugares.liberados",
        correlationId: evento.correlationId,
        payload: {
          pedidoId,
          eventoId: reserva.eventoId,
          motivo,
          itens: reserva.itens,
          destinatarios: [] as string[],
        },
      }],
    };
  }));
}

/**
 * Evento cancelado: devolve ao estoque TODAS as reservas ativas dele.
 *
 * Este serviço reage ao próprio evento que publicou. É de propósito: o estoque
 * volta a bater mesmo que a cadeia de cancelamento dos ingressos demore ou falhe,
 * e a operação é idempotente pelo mesmo mecanismo da reserva.
 */
export function tratarEventoCancelado(evento: EventEnvelope<{ eventoId: string }>) {
  return idempotente(evento, () => transacao(async (c) => {
    const { eventoId } = evento.payload;
    const ativas = await repo.reservasAtivasDoEvento(c, eventoId);

    for (const reserva of ativas) {
      for (const item of reserva.itens) await repo.liberarLugares(c, item.loteId, item.quantidade);
      await repo.marcarReservaLiberada(c, reserva.pedidoId);
    }

    if (ativas.length) console.log(`[eventos] evento ${eventoId} cancelado: ${ativas.length} reserva(s) liberada(s)`);
    return [];
  }));
}

/**
 * Conta removida: o organizador sumiu. Os eventos dele que ainda não aconteceram
 * são cancelados, o que dispara a cadeia normal de compensação (lote 5).
 */
export function tratarUsuarioRemovido(evento: EventEnvelope<{ usuarioId: string; nome?: string }>) {
  return idempotente(evento, () => transacao(async (c) => {
    const { usuarioId } = evento.payload;
    const ativos = await repo.ativosDoOrganizador(c, usuarioId);
    const saidas: EventoSaida[] = [];

    for (const e of ativos) {
      await repo.atualizarStatus(c, e.id, "CANCELADO", "o organizador encerrou a conta");
      saidas.push({
        nome: "evento.cancelado",
        correlationId: evento.correlationId,
        payload: {
          eventoId: e.id,
          nome: e.nome,
          dataHora: e.dataHora.toISOString(),
          local: e.local,
          motivo: "o organizador encerrou a conta",
          organizadorId: e.organizadorId,
          destinatarios: [] as string[],
        },
      });
    }

    if (saidas.length) console.log(`[eventos] conta ${usuarioId} removida: ${saidas.length} evento(s) cancelado(s)`);
    return saidas;
  }));
}
