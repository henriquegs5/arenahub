/**
 * Padrões GoF: STRATEGY + FACTORY METHOD — meio de pagamento.
 *
 * Cada meio tem regras próprias (prazo de confirmação, limite, se aceita
 * estorno imediato). O serviço nunca pergunta "é pix ou cartão?": pede ao meio.
 * Acrescentar um meio novo é criar uma classe, sem tocar no processador.
 *
 * SEGURANÇA — nunca guardamos dado sensível de cartão.
 * O que trafega e o que é gravado é apenas uma REFERÊNCIA opaca ao meio de
 * pagamento (um token, como o que um provedor real devolve depois de
 * tokenizar o cartão no navegador do comprador). Número, CVV e validade não
 * entram neste sistema em nenhum momento — ver `mascarar()` e o README.
 */
export type MeioPagamento = "PIX" | "CARTAO_CREDITO" | "BOLETO" | "CARTAO_RECUSADO";

export const MEIOS_PAGAMENTO: MeioPagamento[] = ["PIX", "CARTAO_CREDITO", "BOLETO", "CARTAO_RECUSADO"];

export interface EstrategiaMeioPagamento {
  readonly nome: MeioPagamento;
  readonly rotulo: string;
  /** Valor máximo aceito, em centavos. */
  readonly limiteCentavos: number;
  /** O meio permite estorno automático? */
  aceitaEstorno(): boolean;
  /**
   * Regra determinística de aprovação, para a demonstração ser previsível.
   * Devolve o motivo da recusa, ou null para aprovar.
   */
  avaliar(valorCentavos: number): string | null;
}

/**
 * GATILHO DE RECUSA COMPARTILHADO: qualquer pagamento cujo total termine em
 * **,66** é recusado. É o gatilho que o apresentador provoca na hora, ajustando
 * a quantidade ou o lote até o total terminar em 66 centavos (R$ 6,66, R$ 80,66).
 * Documentado no README e mostrado na própria tela de compra.
 */
export const CENTAVOS_RECUSA = 66;

export const terminaEmCentavosDeRecusa = (valorCentavos: number): boolean =>
  valorCentavos > 0 && valorCentavos % 100 === CENTAVOS_RECUSA;

abstract class MeioBase implements EstrategiaMeioPagamento {
  abstract readonly nome: MeioPagamento;
  abstract readonly rotulo: string;
  readonly limiteCentavos: number = 5_000_000; // R$ 50.000,00

  aceitaEstorno(): boolean { return true; }

  avaliar(valorCentavos: number): string | null {
    if (valorCentavos < 0) return "valor inválido";
    if (valorCentavos > this.limiteCentavos)
      return `valor acima do limite de ${this.rotulo} para esta transação`;
    if (terminaEmCentavosDeRecusa(valorCentavos))
      return `pagamento não autorizado pelo emissor (valor terminado em ${CENTAVOS_RECUSA} centavos)`;
    return null;
  }
}

class Pix extends MeioBase {
  readonly nome: MeioPagamento = "PIX";
  readonly rotulo = "Pix";
  readonly limiteCentavos = 2_000_000; // R$ 20.000,00
}

class CartaoCredito extends MeioBase {
  readonly nome: MeioPagamento = "CARTAO_CREDITO";
  readonly rotulo = "Cartão de crédito";
}

class Boleto extends MeioBase {
  readonly nome: MeioPagamento = "BOLETO";
  readonly rotulo = "Boleto";
  /** Boleto compensado não volta sozinho: o estorno é manual. */
  aceitaEstorno(): boolean { return false; }
}

/**
 * GATILHO DE RECUSA DEDICADO: este meio recusa SEMPRE, qualquer valor.
 * Existe só para a demonstração — é o caminho mais direto para o apresentador
 * mostrar a compensação da Saga sem precisar acertar o valor.
 */
class CartaoRecusado extends MeioBase {
  readonly nome: MeioPagamento = "CARTAO_RECUSADO";
  readonly rotulo = "Cartão de teste (recusa sempre)";
  avaliar(): string | null {
    return "cartão recusado pelo emissor (meio de teste, recusa sempre)";
  }
}

/** FACTORY METHOD: o criador declara o método; a subclasse escolhe a estratégia. */
export abstract class CriadorMeioPagamento {
  abstract criarEstrategia(): EstrategiaMeioPagamento;
}

export class CriadorPix extends CriadorMeioPagamento {
  criarEstrategia(): EstrategiaMeioPagamento { return new Pix(); }
}
export class CriadorCartaoCredito extends CriadorMeioPagamento {
  criarEstrategia(): EstrategiaMeioPagamento { return new CartaoCredito(); }
}
export class CriadorBoleto extends CriadorMeioPagamento {
  criarEstrategia(): EstrategiaMeioPagamento { return new Boleto(); }
}
export class CriadorCartaoRecusado extends CriadorMeioPagamento {
  criarEstrategia(): EstrategiaMeioPagamento { return new CartaoRecusado(); }
}

export function criadorPara(meio: MeioPagamento): CriadorMeioPagamento {
  switch (meio) {
    case "PIX": return new CriadorPix();
    case "CARTAO_CREDITO": return new CriadorCartaoCredito();
    case "BOLETO": return new CriadorBoleto();
    case "CARTAO_RECUSADO": return new CriadorCartaoRecusado();
  }
}

export const estrategiaPara = (meio: MeioPagamento): EstrategiaMeioPagamento =>
  criadorPara(meio).criarEstrategia();

export const meioValido = (m: unknown): m is MeioPagamento =>
  typeof m === "string" && (MEIOS_PAGAMENTO as string[]).includes(m);

export const emReais = (centavos: number): string =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
