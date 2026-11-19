/**
 * Padrões GoF: STRATEGY + FACTORY METHOD.
 *
 * STRATEGY — cada política de preço do ingresso é uma estratégia plugável.
 * O serviço nunca pergunta "que política é esta?": ele pede o preço à estratégia.
 * Criar uma política nova (meia para professor, passaporte, etc.) é acrescentar
 * uma classe, sem tocar em quem calcula o total.
 *
 * FACTORY METHOD — o criador declara `criarEstrategia()` e cada subclasse decide
 * qual estratégia instanciar; `criadorPara()` escolhe o criador pela política.
 *
 * DINHEIRO EM CENTAVOS (inteiro). Nunca em ponto flutuante: R$ 0,1 + R$ 0,2 não
 * dá R$ 0,3 em binário, e o erro apareceria no total do pedido.
 */
export type PoliticaPreco = "INTEIRA" | "MEIA" | "PROMOCIONAL" | "CORTESIA";

export const POLITICAS_PRECO: PoliticaPreco[] = ["INTEIRA", "MEIA", "PROMOCIONAL", "CORTESIA"];

export interface EstrategiaPreco {
  readonly nome: PoliticaPreco;
  readonly rotulo: string;
  /**
   * Preço unitário em centavos.
   * @param precoBase          preço cheio do lote, em centavos
   * @param descontoPercentual desconto do lote (0 a 100), usado pela política promocional
   */
  precoUnitario(precoBase: number, descontoPercentual: number): number;
}

/** Entrada inteira: o preço cheio do lote. */
class Inteira implements EstrategiaPreco {
  readonly nome: PoliticaPreco = "INTEIRA";
  readonly rotulo = "Inteira";
  precoUnitario(precoBase: number) { return Math.max(0, Math.round(precoBase)); }
}

/** Meia-entrada: metade do preço cheio, arredondada ao centavo. */
class Meia implements EstrategiaPreco {
  readonly nome: PoliticaPreco = "MEIA";
  readonly rotulo = "Meia-entrada";
  precoUnitario(precoBase: number) { return Math.max(0, Math.round(precoBase / 2)); }
}

/** Preço promocional do lote (primeiro lote, pré-venda): aplica o desconto do lote. */
class Promocional implements EstrategiaPreco {
  readonly nome: PoliticaPreco = "PROMOCIONAL";
  readonly rotulo = "Promocional do lote";
  precoUnitario(precoBase: number, descontoPercentual: number) {
    const desconto = Math.min(Math.max(descontoPercentual, 0), 100);
    return Math.max(0, Math.round((precoBase * (100 - desconto)) / 100));
  }
}

/** Cortesia: convidado do organizador, sem cobrança. */
class Cortesia implements EstrategiaPreco {
  readonly nome: PoliticaPreco = "CORTESIA";
  readonly rotulo = "Cortesia";
  precoUnitario() { return 0; }
}

/** FACTORY METHOD: o criador declara o método; a subclasse escolhe a estratégia. */
export abstract class CriadorPreco {
  abstract criarEstrategia(): EstrategiaPreco;
}

export class CriadorInteira extends CriadorPreco {
  criarEstrategia(): EstrategiaPreco { return new Inteira(); }
}
export class CriadorMeia extends CriadorPreco {
  criarEstrategia(): EstrategiaPreco { return new Meia(); }
}
export class CriadorPromocional extends CriadorPreco {
  criarEstrategia(): EstrategiaPreco { return new Promocional(); }
}
export class CriadorCortesia extends CriadorPreco {
  criarEstrategia(): EstrategiaPreco { return new Cortesia(); }
}

export function criadorPara(politica: PoliticaPreco): CriadorPreco {
  switch (politica) {
    case "INTEIRA": return new CriadorInteira();
    case "MEIA": return new CriadorMeia();
    case "PROMOCIONAL": return new CriadorPromocional();
    case "CORTESIA": return new CriadorCortesia();
  }
}

/** Atalho: a estratégia já pronta para a política informada. */
export const estrategiaPara = (politica: PoliticaPreco): EstrategiaPreco =>
  criadorPara(politica).criarEstrategia();

/** Formata centavos como moeda brasileira, para mensagens e avisos. */
export const emReais = (centavos: number): string =>
  (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
