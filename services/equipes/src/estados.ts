/**
 * Padrão GoF: STATE (ciclo de vida da solicitação de entrada numa equipe).
 *
 * PENDENTE ─┬─ aceitar  ─▶ ACEITA
 *           ├─ recusar  ─▶ RECUSADA
 *           └─ cancelar ─▶ CANCELADA
 *
 * ACEITA, RECUSADA e CANCELADA são finais: qualquer transição a partir delas
 * lança TransicaoInvalida, do mesmo jeito que em torneios e partidas.
 */
export type StatusSolicitacao = "PENDENTE" | "ACEITA" | "RECUSADA" | "CANCELADA";

export class TransicaoInvalida extends Error {
  constructor(de: StatusSolicitacao, acao: string) {
    super(`não é possível ${acao} uma solicitação ${de.toLowerCase()}`);
  }
}

export abstract class EstadoSolicitacao {
  abstract readonly nome: StatusSolicitacao;
  /** Só uma solicitação pendente ocupa a "vaga" de pedido do jogador. */
  pendente(): boolean { return false; }
  aceitar(): EstadoSolicitacao { throw new TransicaoInvalida(this.nome, "aceitar"); }
  recusar(): EstadoSolicitacao { throw new TransicaoInvalida(this.nome, "recusar"); }
  cancelar(): EstadoSolicitacao { throw new TransicaoInvalida(this.nome, "cancelar"); }
}

class Pendente extends EstadoSolicitacao {
  readonly nome: StatusSolicitacao = "PENDENTE";
  pendente() { return true; }
  aceitar() { return new Aceita(); }
  recusar() { return new Recusada(); }
  cancelar() { return new Cancelada(); }
}
class Aceita extends EstadoSolicitacao {
  readonly nome: StatusSolicitacao = "ACEITA";
}
class Recusada extends EstadoSolicitacao {
  readonly nome: StatusSolicitacao = "RECUSADA";
}
class Cancelada extends EstadoSolicitacao {
  readonly nome: StatusSolicitacao = "CANCELADA";
}

export function estadoDe(status: StatusSolicitacao): EstadoSolicitacao {
  switch (status) {
    case "PENDENTE": return new Pendente();
    case "ACEITA": return new Aceita();
    case "RECUSADA": return new Recusada();
    case "CANCELADA": return new Cancelada();
  }
}
