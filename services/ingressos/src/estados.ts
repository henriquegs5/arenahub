/**
 * Padrão GoF: STATE — duas máquinas de estado, uma para o PEDIDO e outra para o
 * INGRESSO. Cada estado decide o que aceita; o resto do serviço nunca testa
 * `if (status === ...)` para saber se uma ação é possível.
 *
 * PEDIDO (dirigido pela Saga)
 *
 *   PENDENTE ──▶ RESERVADO ──▶ AGUARDANDO_PAGAMENTO ──▶ PAGO ──▶ CONCLUIDO
 *       │            │                   │
 *       └────────────┴───────────────────┴──▶ CANCELADO | RECUSADO | EXPIRADO
 *
 * PENDENTE              pedido criado, esperando a reserva dos lugares.
 * RESERVADO             Eventos confirmou os lugares.
 * AGUARDANDO_PAGAMENTO  cobrança pedida ao serviço de Pagamento.
 * PAGO                  cobrança aprovada; os ingressos vão ser emitidos.
 * CONCLUIDO             ingressos emitidos.
 * RECUSADO              o pagamento não passou (compensado).
 * EXPIRADO              estourou o prazo sem concluir (compensado).
 * CANCELADO             cancelado pelo comprador, pelo ADM ou por evento cancelado.
 */
export type StatusPedido =
  | "PENDENTE"
  | "RESERVADO"
  | "AGUARDANDO_PAGAMENTO"
  | "PAGO"
  | "CONCLUIDO"
  | "RECUSADO"
  | "EXPIRADO"
  | "CANCELADO";

export const STATUS_PEDIDO: StatusPedido[] = [
  "PENDENTE", "RESERVADO", "AGUARDANDO_PAGAMENTO", "PAGO",
  "CONCLUIDO", "RECUSADO", "EXPIRADO", "CANCELADO",
];

/** Estados finais: não saem mais daqui. */
export const PEDIDO_FINALIZADO: StatusPedido[] = ["CONCLUIDO", "RECUSADO", "EXPIRADO", "CANCELADO"];

/** Estados em que o pedido ainda está rodando e pode expirar. */
export const PEDIDO_EM_ANDAMENTO: StatusPedido[] = ["PENDENTE", "RESERVADO", "AGUARDANDO_PAGAMENTO", "PAGO"];

export class TransicaoInvalida extends Error {
  constructor(de: string, acao: string) {
    super(`não é possível ${acao} um pedido em ${de}`);
    this.name = "TransicaoInvalida";
  }
}

export abstract class EstadoPedido {
  abstract readonly nome: StatusPedido;

  /** Já houve reserva de lugares? Decide se a compensação precisa liberá-los. */
  temLugaresReservados(): boolean { return false; }

  /** O comprador ainda pode cancelar? */
  aceitaCancelamento(): boolean { return false; }

  /** O pedido ainda está correndo, logo pode expirar. */
  emAndamento(): boolean { return !PEDIDO_FINALIZADO.includes(this.nome); }

  /** Houve cobrança aprovada que precisa de estorno ao cancelar? */
  exigeEstorno(): boolean { return false; }

  reservar(): EstadoPedido { throw new TransicaoInvalida(this.nome, "reservar lugares para"); }
  cobrar(): EstadoPedido { throw new TransicaoInvalida(this.nome, "cobrar"); }
  aprovar(): EstadoPedido { throw new TransicaoInvalida(this.nome, "aprovar o pagamento de"); }
  concluir(): EstadoPedido { throw new TransicaoInvalida(this.nome, "concluir"); }
  recusar(): EstadoPedido { throw new TransicaoInvalida(this.nome, "recusar"); }
  expirar(): EstadoPedido { throw new TransicaoInvalida(this.nome, "expirar"); }
  cancelar(): EstadoPedido { throw new TransicaoInvalida(this.nome, "cancelar"); }
}

class Pendente extends EstadoPedido {
  readonly nome: StatusPedido = "PENDENTE";
  aceitaCancelamento() { return true; }
  reservar() { return new Reservado(); }
  recusar() { return new Recusado(); }
  expirar() { return new Expirado(); }
  cancelar() { return new Cancelado(); }
}

class Reservado extends EstadoPedido {
  readonly nome: StatusPedido = "RESERVADO";
  temLugaresReservados() { return true; }
  aceitaCancelamento() { return true; }
  cobrar() { return new AguardandoPagamento(); }
  recusar() { return new Recusado(); }
  expirar() { return new Expirado(); }
  cancelar() { return new Cancelado(); }
}

class AguardandoPagamento extends EstadoPedido {
  readonly nome: StatusPedido = "AGUARDANDO_PAGAMENTO";
  temLugaresReservados() { return true; }
  aceitaCancelamento() { return true; }
  aprovar() { return new Pago(); }
  recusar() { return new Recusado(); }
  expirar() { return new Expirado(); }
  cancelar() { return new Cancelado(); }
}

class Pago extends EstadoPedido {
  readonly nome: StatusPedido = "PAGO";
  temLugaresReservados() { return true; }
  exigeEstorno() { return true; }
  concluir() { return new Concluido(); }
  cancelar() { return new Cancelado(); }
  // Pago mas sem ingresso emitido ainda: o varredor conclui a emissão,
  // nunca expira um pedido cujo dinheiro já entrou.
  expirar(): EstadoPedido { throw new TransicaoInvalida(this.nome, "expirar"); }
}

class Concluido extends EstadoPedido {
  readonly nome: StatusPedido = "CONCLUIDO";
  temLugaresReservados() { return true; }
  exigeEstorno() { return true; }
  aceitaCancelamento() { return true; }
  cancelar() { return new Cancelado(); }
}

class Recusado extends EstadoPedido {
  readonly nome: StatusPedido = "RECUSADO";
}
class Expirado extends EstadoPedido {
  readonly nome: StatusPedido = "EXPIRADO";
}
class Cancelado extends EstadoPedido {
  readonly nome: StatusPedido = "CANCELADO";
}

export function estadoPedido(status: StatusPedido): EstadoPedido {
  switch (status) {
    case "PENDENTE": return new Pendente();
    case "RESERVADO": return new Reservado();
    case "AGUARDANDO_PAGAMENTO": return new AguardandoPagamento();
    case "PAGO": return new Pago();
    case "CONCLUIDO": return new Concluido();
    case "RECUSADO": return new Recusado();
    case "EXPIRADO": return new Expirado();
    case "CANCELADO": return new Cancelado();
  }
}

/**
 * INGRESSO
 *
 *   EMITIDO ──▶ UTILIZADO        (check-in na entrada, uma única vez)
 *      │
 *      ├──▶ CANCELADO            (o comprador cancelou o pedido)
 *      └──▶ INVALIDADO           (o evento foi cancelado)
 */
export type StatusIngresso = "EMITIDO" | "UTILIZADO" | "CANCELADO" | "INVALIDADO";

export abstract class EstadoIngresso {
  abstract readonly nome: StatusIngresso;

  /** Vale para entrar? */
  valido(): boolean { return false; }

  /** Motivo da recusa na portaria, quando não vale. */
  motivoRecusa(): string { return "ingresso inválido"; }

  validar(): EstadoIngresso { throw new Error(this.motivoRecusa()); }
  cancelar(): EstadoIngresso { throw new Error(`não é possível cancelar um ingresso ${this.nome}`); }
  invalidar(): EstadoIngresso { throw new Error(`não é possível invalidar um ingresso ${this.nome}`); }
}

class Emitido extends EstadoIngresso {
  readonly nome: StatusIngresso = "EMITIDO";
  valido() { return true; }
  validar() { return new Utilizado(); }
  cancelar() { return new IngressoCancelado(); }
  invalidar() { return new Invalidado(); }
}

class Utilizado extends EstadoIngresso {
  readonly nome: StatusIngresso = "UTILIZADO";
  motivoRecusa() { return "este ingresso já foi utilizado na entrada"; }
  // Uma vez usado, continua inválido para uma segunda entrada.
  invalidar() { return new Invalidado(); }
}

class IngressoCancelado extends EstadoIngresso {
  readonly nome: StatusIngresso = "CANCELADO";
  motivoRecusa() { return "este ingresso foi cancelado"; }
  invalidar() { return new Invalidado(); }
}

class Invalidado extends EstadoIngresso {
  readonly nome: StatusIngresso = "INVALIDADO";
  motivoRecusa() { return "este ingresso foi invalidado porque o evento foi cancelado"; }
}

export function estadoIngresso(status: StatusIngresso): EstadoIngresso {
  switch (status) {
    case "EMITIDO": return new Emitido();
    case "UTILIZADO": return new Utilizado();
    case "CANCELADO": return new IngressoCancelado();
    case "INVALIDADO": return new Invalidado();
  }
}
