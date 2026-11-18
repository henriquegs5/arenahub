/**
 * Padrão GoF: STATE (ciclo de vida da partida).
 *
 * AGENDADA → RESULTADO_INFORMADO → CONFIRMADA
 *                      └→ CONTESTADA → CONFIRMADA (organizador resolve)
 */
export type StatusPartida = "AGENDADA" | "RESULTADO_INFORMADO" | "CONTESTADA" | "CONFIRMADA";

export class TransicaoInvalida extends Error {
  constructor(de: StatusPartida, acao: string) {
    super(`não é possível ${acao} uma partida em ${de}`);
  }
}

export abstract class EstadoPartida {
  abstract readonly nome: StatusPartida;
  informar(): EstadoPartida { throw new TransicaoInvalida(this.nome, "informar resultado de"); }
  confirmar(): EstadoPartida { throw new TransicaoInvalida(this.nome, "confirmar"); }
  contestar(): EstadoPartida { throw new TransicaoInvalida(this.nome, "contestar"); }
  resolver(): EstadoPartida { throw new TransicaoInvalida(this.nome, "resolver contestação de"); }
}

class Agendada extends EstadoPartida {
  readonly nome: StatusPartida = "AGENDADA";
  informar() { return new ResultadoInformado(); }
}
class ResultadoInformado extends EstadoPartida {
  readonly nome: StatusPartida = "RESULTADO_INFORMADO";
  confirmar() { return new Confirmada(); }
  contestar() { return new Contestada(); }
}
class Contestada extends EstadoPartida {
  readonly nome: StatusPartida = "CONTESTADA";
  resolver() { return new Confirmada(); }
}
class Confirmada extends EstadoPartida {
  readonly nome: StatusPartida = "CONFIRMADA";
}

export function estadoDe(status: StatusPartida): EstadoPartida {
  switch (status) {
    case "AGENDADA": return new Agendada();
    case "RESULTADO_INFORMADO": return new ResultadoInformado();
    case "CONTESTADA": return new Contestada();
    case "CONFIRMADA": return new Confirmada();
  }
}
