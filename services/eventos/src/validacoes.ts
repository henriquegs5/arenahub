import { estadoDe } from "./estados";
import { EventoComposto } from "./estrutura";
import { PoliticaPreco } from "./precos";
import { Evento } from "./repositorio";

/**
 * Padrão GoF: CHAIN OF RESPONSIBILITY.
 *
 * As validações da compra que dependem de dados do EVENTO rodam aqui, no serviço
 * que é dono desses dados. Cada elo decide uma coisa só; quem recusa interrompe a
 * cadeia e devolve o motivo, que vira a mensagem de `reserva.recusada`.
 *
 * A divisão das validações entre os dois serviços é proposital:
 *
 *   Ingressos (validacoes.ts de lá)  papel do comprador, itens bem formados,
 *                                    limite por comprador, pedido duplicado.
 *   Eventos   (este arquivo)         evento publicado, vendas abertas, lote
 *                                    pertence ao evento, lote vigente, capacidade.
 *
 * Cada serviço valida o que POSSUI. Se Ingressos fosse validar "as vendas estão
 * abertas?", teria de perguntar a Eventos por HTTP — e um serviço não chama outro
 * para validar algo; é justamente isso que a Saga existe para evitar.
 */

export interface ItemPedido {
  loteId: string;
  quantidade: number;
  politica: PoliticaPreco;
}

export interface ContextoReserva {
  evento: Evento;
  arvore: EventoComposto;
  itens: ItemPedido[];
  agora: Date;
}

/** Elo da cadeia. `avaliar` devolve o motivo da recusa, ou null se aprovar. */
export abstract class ValidacaoReserva {
  private proximo: ValidacaoReserva | null = null;

  /** Encadeia e devolve o elo recebido, para montar a cadeia fluentemente. */
  encadear(proximo: ValidacaoReserva): ValidacaoReserva {
    this.proximo = proximo;
    return proximo;
  }

  /** Percorre a cadeia. Para no primeiro elo que recusar. */
  verificar(ctx: ContextoReserva): string | null {
    const recusa = this.avaliar(ctx);
    if (recusa) return recusa;
    return this.proximo ? this.proximo.verificar(ctx) : null;
  }

  protected abstract avaliar(ctx: ContextoReserva): string | null;
}

/** As vendas precisam estar abertas (decidido pelo State do evento). */
class VendasPrecisamEstarAbertas extends ValidacaoReserva {
  protected avaliar({ evento }: ContextoReserva) {
    if (evento.status === "CANCELADO") return "este evento foi cancelado";
    if (!estadoDe(evento.status).aceitaVendas())
      return `as vendas deste evento não estão abertas (situação: ${evento.status})`;
    return null;
  }
}

/** O pedido precisa ter itens bem formados, sem lote repetido. */
class ItensPrecisamSerValidos extends ValidacaoReserva {
  protected avaliar({ itens }: ContextoReserva) {
    if (itens.length === 0) return "o pedido não tem itens";
    if (itens.some((i) => !Number.isInteger(i.quantidade) || i.quantidade < 1))
      return "a quantidade de cada item precisa ser um inteiro maior que zero";
    const ids = new Set(itens.map((i) => i.loteId));
    if (ids.size !== itens.length) return "o mesmo lote aparece mais de uma vez no pedido";
    return null;
  }
}

/** Cada lote precisa ser deste evento — não adianta pedir lote de outro. */
class LotesPrecisamSerDoEvento extends ValidacaoReserva {
  protected avaliar({ arvore, itens }: ContextoReserva) {
    for (const item of itens) {
      if (!arvore.acharLote(item.loteId)) return "um dos lotes não pertence a este evento";
    }
    return null;
  }
}

/** O lote precisa estar vigente: ativo e dentro da janela de venda. */
class LotesPrecisamEstarVigentes extends ValidacaoReserva {
  protected avaliar({ arvore, itens, agora }: ContextoReserva) {
    for (const item of itens) {
      const lote = arvore.acharLote(item.loteId)!;
      if (!lote.vigente(agora)) return `o lote "${lote.nome}" não está disponível para venda agora`;
    }
    return null;
  }
}

/**
 * Conferência prévia de capacidade, para recusar com uma mensagem boa.
 * A garantia de verdade é o UPDATE atômico na hora de reservar: entre esta
 * checagem e a reserva, outro comprador pode levar o último lugar.
 */
class PrecisaHaverLugar extends ValidacaoReserva {
  protected avaliar({ arvore, itens }: ContextoReserva) {
    for (const item of itens) {
      const lote = arvore.acharLote(item.loteId)!;
      if (lote.disponiveis() < item.quantidade)
        return `o lote "${lote.nome}" tem apenas ${lote.disponiveis()} lugar(es) disponível(is)`;
    }
    return null;
  }
}

/** Monta a cadeia na ordem em que faz sentido recusar. */
export function cadeiaDeReserva(): ValidacaoReserva {
  const primeiro = new VendasPrecisamEstarAbertas();
  primeiro
    .encadear(new ItensPrecisamSerValidos())
    .encadear(new LotesPrecisamSerDoEvento())
    .encadear(new LotesPrecisamEstarVigentes())
    .encadear(new PrecisaHaverLugar());
  return primeiro;
}
