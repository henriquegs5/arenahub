/**
 * Padrão GoF: STATE.
 *
 * O ciclo de vida do evento é modelado por um objeto de estado por situação.
 * Cada estado decide quais transições aceita e o que permite fazer; as demais
 * lançam TransicaoInvalida. Nenhum `if (status === ...)` espalhado pelo serviço.
 *
 *   RASCUNHO ──▶ PUBLICADO ──▶ VENDAS_ABERTAS ──▶ VENDAS_ENCERRADAS ──▶ REALIZADO
 *       │            │               │                    │
 *       └────────────┴───────────────┴────────────────────┴──▶ CANCELADO
 *
 * RASCUNHO           só o organizador vê; a estrutura está sendo montada.
 * PUBLICADO          visível no catálogo, mas ainda sem vender.
 * VENDAS_ABERTAS     única situação em que se reserva lugar.
 * VENDAS_ENCERRADAS  nada mais é vendido; os ingressos emitidos valem na entrada.
 * REALIZADO          o evento aconteceu; nada mais muda.
 * CANCELADO          dispara invalidação dos ingressos e estorno (lote 5).
 */
export type StatusEvento =
  | "RASCUNHO"
  | "PUBLICADO"
  | "VENDAS_ABERTAS"
  | "VENDAS_ENCERRADAS"
  | "REALIZADO"
  | "CANCELADO";

export const STATUS_EVENTO: StatusEvento[] = [
  "RASCUNHO", "PUBLICADO", "VENDAS_ABERTAS", "VENDAS_ENCERRADAS", "REALIZADO", "CANCELADO",
];

export class TransicaoInvalida extends Error {
  constructor(de: StatusEvento, acao: string) {
    super(`não é possível ${acao} um evento em ${de}`);
    this.name = "TransicaoInvalida";
  }
}

export abstract class EstadoEvento {
  abstract readonly nome: StatusEvento;

  /** Só se reserva lugar com as vendas abertas. */
  aceitaVendas(): boolean { return false; }

  /** O evento aparece no catálogo para quem não é o organizador. */
  visivelNoCatalogo(): boolean { return true; }

  /** Setores e lotes podem ser criados, editados ou excluídos. */
  aceitaEdicaoEstrutura(): boolean { return false; }

  /** Nome, descrição, data e local podem ser alterados. */
  aceitaEdicaoDados(): boolean { return false; }

  /** Um evento encerrado ou já realizado não é apagado, para preservar o histórico. */
  permiteExclusao(): boolean { return false; }

  publicar(): EstadoEvento { throw new TransicaoInvalida(this.nome, "publicar"); }
  abrirVendas(): EstadoEvento { throw new TransicaoInvalida(this.nome, "abrir as vendas de"); }
  encerrarVendas(): EstadoEvento { throw new TransicaoInvalida(this.nome, "encerrar as vendas de"); }
  realizar(): EstadoEvento { throw new TransicaoInvalida(this.nome, "marcar como realizado"); }
  cancelar(): EstadoEvento { throw new TransicaoInvalida(this.nome, "cancelar"); }
}

class Rascunho extends EstadoEvento {
  readonly nome: StatusEvento = "RASCUNHO";
  visivelNoCatalogo() { return false; }
  aceitaEdicaoEstrutura() { return true; }
  aceitaEdicaoDados() { return true; }
  permiteExclusao() { return true; }
  publicar() { return new Publicado(); }
  cancelar() { return new Cancelado(); }
}

class Publicado extends EstadoEvento {
  readonly nome: StatusEvento = "PUBLICADO";
  aceitaEdicaoEstrutura() { return true; }
  aceitaEdicaoDados() { return true; }
  permiteExclusao() { return true; }
  abrirVendas() { return new VendasAbertas(); }
  cancelar() { return new Cancelado(); }
}

class VendasAbertas extends EstadoEvento {
  readonly nome: StatusEvento = "VENDAS_ABERTAS";
  aceitaVendas() { return true; }
  // Acrescentar um lote novo com as vendas abertas é prática comum; o que não se
  // permite é reduzir capacidade abaixo do já reservado (verificado no serviço).
  aceitaEdicaoEstrutura() { return true; }
  aceitaEdicaoDados() { return true; }
  encerrarVendas() { return new VendasEncerradas(); }
  cancelar() { return new Cancelado(); }
}

class VendasEncerradas extends EstadoEvento {
  readonly nome: StatusEvento = "VENDAS_ENCERRADAS";
  // Data e local ainda podem mudar de última hora; quem comprou é avisado.
  aceitaEdicaoDados() { return true; }
  realizar() { return new Realizado(); }
  cancelar() { return new Cancelado(); }
}

class Realizado extends EstadoEvento {
  readonly nome: StatusEvento = "REALIZADO";
}

class Cancelado extends EstadoEvento {
  readonly nome: StatusEvento = "CANCELADO";
}

export function estadoDe(status: StatusEvento): EstadoEvento {
  switch (status) {
    case "RASCUNHO": return new Rascunho();
    case "PUBLICADO": return new Publicado();
    case "VENDAS_ABERTAS": return new VendasAbertas();
    case "VENDAS_ENCERRADAS": return new VendasEncerradas();
    case "REALIZADO": return new Realizado();
    case "CANCELADO": return new Cancelado();
  }
}
