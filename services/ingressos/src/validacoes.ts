import { Autor } from "./auth";
import { LIMITE_POR_COMPRADOR } from "./config";
import { meioValido } from "./meios";

/**
 * Padrão GoF: CHAIN OF RESPONSIBILITY — validações da compra.
 *
 * Cada elo decide uma coisa só e, se recusar, interrompe a cadeia. Acrescentar
 * uma regra (cupom, lote exclusivo para sócio) é escrever um elo e encaixá-lo,
 * sem mexer nos outros nem no serviço.
 *
 * DIVISÃO ENTRE OS SERVIÇOS — esta cadeia valida o que o serviço de INGRESSOS
 * possui: quem é o comprador, se os itens estão bem formados, o limite por
 * comprador e se já existe um pedido rodando. O que depende dos dados do EVENTO
 * (vendas abertas, lote vigente, capacidade) é validado pela cadeia do serviço
 * de Eventos, no passo de reserva da Saga.
 *
 * É de propósito: cada serviço valida o que é dono. Se Ingressos fosse conferir
 * "as vendas estão abertas?", teria de chamar Eventos por HTTP — e um serviço
 * não chama outro para validar algo. É exatamente o que a Saga evita.
 */

export interface ItemCompra {
  loteId: string;
  quantidade: number;
  politica: string;
}

export interface ContextoCompra {
  autor: Autor;
  eventoId: string;
  itens: ItemCompra[];
  meio: string;
  referenciaPagamento: string;
  /** Quantos ingressos este comprador já tem deste evento. */
  jaPedidos: number;
  /** Já existe um pedido deste comprador rodando para este evento? */
  pedidoEmAndamento: boolean;
}

/** Recusa com o status HTTP adequado. */
export interface Recusa {
  status: number;
  mensagem: string;
}

export abstract class ValidacaoCompra {
  private proximo: ValidacaoCompra | null = null;

  encadear(proximo: ValidacaoCompra): ValidacaoCompra {
    this.proximo = proximo;
    return proximo;
  }

  verificar(ctx: ContextoCompra): Recusa | null {
    const recusa = this.avaliar(ctx);
    if (recusa) return recusa;
    return this.proximo ? this.proximo.verificar(ctx) : null;
  }

  protected abstract avaliar(ctx: ContextoCompra): Recusa | null;
}

/** Organizador não compra ingresso do próprio circuito; participante e ADM sim. */
class CompradorPrecisaPoderComprar extends ValidacaoCompra {
  protected avaliar({ autor }: ContextoCompra) {
    if (autor.papel === "ORGANIZADOR")
      return { status: 403, mensagem: "contas de organizador não compram ingressos; use uma conta de participante" };
    return null;
  }
}

/** Itens bem formados: pelo menos um, quantidade sadia, sem lote repetido. */
class ItensPrecisamSerValidos extends ValidacaoCompra {
  private static readonly MAX_ITENS = 10;
  private static readonly MAX_POR_ITEM = 20;

  protected avaliar({ itens }: ContextoCompra) {
    if (itens.length === 0) return { status: 400, mensagem: "escolha ao menos um lote" };
    if (itens.length > ItensPrecisamSerValidos.MAX_ITENS)
      return { status: 400, mensagem: `no máximo ${ItensPrecisamSerValidos.MAX_ITENS} lotes por pedido` };

    for (const i of itens) {
      if (!Number.isInteger(i.quantidade) || i.quantidade < 1 || i.quantidade > ItensPrecisamSerValidos.MAX_POR_ITEM)
        return { status: 400, mensagem: `a quantidade de cada lote deve ser de 1 a ${ItensPrecisamSerValidos.MAX_POR_ITEM}` };
    }

    const ids = new Set(itens.map((i) => i.loteId));
    if (ids.size !== itens.length)
      return { status: 400, mensagem: "o mesmo lote aparece mais de uma vez no pedido" };

    return null;
  }
}

/** O meio de pagamento precisa existir e vir com uma referência. */
class PagamentoPrecisaSerInformado extends ValidacaoCompra {
  protected avaliar({ meio, referenciaPagamento }: ContextoCompra) {
    if (!meioValido(meio)) return { status: 400, mensagem: "escolha um meio de pagamento válido" };
    if (!referenciaPagamento || referenciaPagamento.trim().length < 4)
      return { status: 400, mensagem: "informe a referência do meio de pagamento" };
    // Defesa explícita: o que chega aqui é um token, nunca um cartão.
    if (/^\d{13,19}$/.test(referenciaPagamento.replace(/\s|-/g, "")))
      return {
        status: 400,
        mensagem: "não envie número de cartão: este sistema trabalha apenas com referência (token) do meio de pagamento",
      };
    return null;
  }
}

/** Um pedido por vez, por evento: evita clique duplo virar duas compras. */
class NaoPodeHaverPedidoEmAndamento extends ValidacaoCompra {
  protected avaliar({ pedidoEmAndamento }: ContextoCompra) {
    if (pedidoEmAndamento)
      return { status: 409, mensagem: "você já tem um pedido em andamento para este evento; conclua ou cancele antes" };
    return null;
  }
}

/** Limite de ingressos por comprador, por evento. */
class LimitePorComprador extends ValidacaoCompra {
  protected avaliar({ itens, jaPedidos }: ContextoCompra) {
    const pedindo = itens.reduce((t, i) => t + i.quantidade, 0);
    if (jaPedidos + pedindo > LIMITE_POR_COMPRADOR)
      return {
        status: 409,
        mensagem: `limite de ${LIMITE_POR_COMPRADOR} ingressos por pessoa neste evento` +
          (jaPedidos > 0 ? ` (você já tem ${jaPedidos})` : ""),
      };
    return null;
  }
}

/** Monta a cadeia na ordem em que faz sentido recusar. */
export function cadeiaDeCompra(): ValidacaoCompra {
  const primeiro = new CompradorPrecisaPoderComprar();
  primeiro
    .encadear(new ItensPrecisamSerValidos())
    .encadear(new PagamentoPrecisaSerInformado())
    .encadear(new NaoPodeHaverPedidoEmAndamento())
    .encadear(new LimitePorComprador());
  return primeiro;
}
