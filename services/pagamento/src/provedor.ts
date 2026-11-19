import { randomUUID } from "node:crypto";
import { EstrategiaMeioPagamento, MeioPagamento, emReais, estrategiaPara } from "./meios";

/**
 * Padrão GoF: ADAPTER — provedor de pagamento externo.
 *
 * O "provedor" abaixo imita uma gateway de pagamento de mercado: nomes em
 * inglês, resposta em formato próprio, códigos numéricos. Nosso serviço não
 * conhece nada disso: ele fala com `ProvedorPagamento`, e o Adapter traduz.
 *
 * Trocar de provedor (ou plugar um de verdade) é escrever outro Adapter — o
 * processador de pagamentos não muda uma linha.
 *
 * SEGURANÇA: o Adapter recebe e repassa apenas a REFERÊNCIA opaca do meio de
 * pagamento (token). Número de cartão, CVV e validade nunca chegam a este
 * serviço nem são gravados em lugar nenhum. Ver `mascararReferencia`.
 */

// ---------------------------------------------------------------------------
// O "SDK de terceiros" (simulado), com a interface que ELE quis ter.
// ---------------------------------------------------------------------------

interface ExternalChargeRequest {
  amount_cents: number;
  currency: string;
  payment_token: string;
  method: string;
  idempotency_key: string;
}

interface ExternalChargeResponse {
  charge_id: string;
  status: "approved" | "declined";
  decline_reason?: string;
  authorization_code?: string;
  processed_at: string;
}

interface ExternalRefundResponse {
  refund_id: string;
  status: "refunded" | "rejected";
  reason?: string;
}

/**
 * Cliente do provedor externo, SIMULADO.
 *
 * A decisão é DETERMINÍSTICA para que a demonstração seja previsível: nada de
 * sorteio. Quem decide aprovar ou recusar é a estratégia do meio de pagamento
 * (ver meios.ts), e esta classe só veste a resposta no formato do provedor.
 */
class ClientePagamentoExterno {
  charge(req: ExternalChargeRequest, estrategia: EstrategiaMeioPagamento): ExternalChargeResponse {
    const recusa = estrategia.avaliar(req.amount_cents);
    const agora = new Date().toISOString();

    if (recusa) {
      console.log(
        `[provedor simulado] CHARGE DECLINED amount=${emReais(req.amount_cents)} ` +
        `method=${req.method} reason="${recusa}"`
      );
      return { charge_id: randomUUID(), status: "declined", decline_reason: recusa, processed_at: agora };
    }

    console.log(`[provedor simulado] CHARGE APPROVED amount=${emReais(req.amount_cents)} method=${req.method}`);
    return {
      charge_id: randomUUID(),
      status: "approved",
      authorization_code: gerarAutorizacao(),
      processed_at: agora,
    };
  }

  refund(chargeId: string, estrategia: EstrategiaMeioPagamento): ExternalRefundResponse {
    if (!estrategia.aceitaEstorno()) {
      console.log(`[provedor simulado] REFUND REJECTED charge=${chargeId} (${estrategia.rotulo} não estorna)`);
      return {
        refund_id: randomUUID(),
        status: "rejected",
        reason: `${estrategia.rotulo} não aceita estorno automático; o reembolso é tratado manualmente`,
      };
    }
    console.log(`[provedor simulado] REFUND OK charge=${chargeId}`);
    return { refund_id: randomUUID(), status: "refunded" };
  }
}

const gerarAutorizacao = (): string =>
  Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();

// ---------------------------------------------------------------------------
// A interface que O NOSSO serviço conhece (alvo do Adapter).
// ---------------------------------------------------------------------------

export interface PedidoCobranca {
  pedidoId: string;
  valorCentavos: number;
  meio: MeioPagamento;
  /** Referência OPACA ao meio de pagamento. Nunca o número do cartão. */
  referenciaPagamento: string;
}

export interface ResultadoCobranca {
  aprovado: boolean;
  identificadorExterno: string;
  autorizacao: string | null;
  motivo: string | null;
  processadoEm: string;
}

export interface ResultadoEstorno {
  estornado: boolean;
  identificadorExterno: string;
  motivo: string | null;
}

export interface ProvedorPagamento {
  readonly nome: string;
  cobrar(pedido: PedidoCobranca): Promise<ResultadoCobranca>;
  estornar(identificadorExterno: string, meio: MeioPagamento): Promise<ResultadoEstorno>;
}

/**
 * ADAPTER: adapta ClientePagamentoExterno (amount_cents, payment_token,
 * status "approved"/"declined") à interface ProvedorPagamento do nosso domínio.
 */
export class ProvedorSimuladoAdapter implements ProvedorPagamento {
  readonly nome = "simulado";

  constructor(private readonly cliente = new ClientePagamentoExterno()) {}

  async cobrar(pedido: PedidoCobranca): Promise<ResultadoCobranca> {
    const estrategia = estrategiaPara(pedido.meio);

    const resposta = this.cliente.charge({
      amount_cents: pedido.valorCentavos,
      currency: "BRL",
      payment_token: pedido.referenciaPagamento,
      method: pedido.meio.toLowerCase(),
      // O pedido é a chave de idempotência: reenviar a mesma cobrança não cobra duas vezes.
      idempotency_key: pedido.pedidoId,
    }, estrategia);

    return {
      aprovado: resposta.status === "approved",
      identificadorExterno: resposta.charge_id,
      autorizacao: resposta.authorization_code ?? null,
      motivo: resposta.decline_reason ?? null,
      processadoEm: resposta.processed_at,
    };
  }

  async estornar(identificadorExterno: string, meio: MeioPagamento): Promise<ResultadoEstorno> {
    const resposta = this.cliente.refund(identificadorExterno, estrategiaPara(meio));
    return {
      estornado: resposta.status === "refunded",
      identificadorExterno: resposta.refund_id,
      motivo: resposta.reason ?? null,
    };
  }
}

/**
 * Mascara a referência do meio de pagamento para log e para a API.
 * Mesmo sendo um token (e não um cartão), não se expõe inteiro.
 */
export const mascararReferencia = (referencia: string): string =>
  referencia.length <= 4 ? "****" : `****${referencia.slice(-4)}`;
