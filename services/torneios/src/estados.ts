/**
 * Padrão GoF: STATE.
 * O ciclo de vida do torneio é modelado por um objeto de estado por situação.
 * Cada estado decide quais transições aceita; as demais lançam TransicaoInvalida.
 *
 * RASCUNHO → INSCRICOES_ABERTAS → EM_ANDAMENTO → FINALIZADO
 * (CANCELADO a partir de qualquer estado antes de finalizar)
 */
export type StatusTorneio = "RASCUNHO" | "INSCRICOES_ABERTAS" | "EM_ANDAMENTO" | "FINALIZADO" | "CANCELADO";

export class TransicaoInvalida extends Error {
  constructor(de: StatusTorneio, acao: string) {
    super(`não é possível ${acao} um torneio em ${de}`);
  }
}

export abstract class EstadoTorneio {
  abstract readonly nome: StatusTorneio;
  aceitaInscricoes(): boolean { return false; }
  abrirInscricoes(): EstadoTorneio { throw new TransicaoInvalida(this.nome, "abrir inscrições de"); }
  iniciar(): EstadoTorneio { throw new TransicaoInvalida(this.nome, "iniciar"); }
  finalizar(): EstadoTorneio { throw new TransicaoInvalida(this.nome, "finalizar"); }
  cancelar(): EstadoTorneio { throw new TransicaoInvalida(this.nome, "cancelar"); }
}

class Rascunho extends EstadoTorneio {
  readonly nome: StatusTorneio = "RASCUNHO";
  abrirInscricoes() { return new InscricoesAbertas(); }
  cancelar() { return new Cancelado(); }
}
class InscricoesAbertas extends EstadoTorneio {
  readonly nome: StatusTorneio = "INSCRICOES_ABERTAS";
  aceitaInscricoes() { return true; }
  iniciar() { return new EmAndamento(); }
  cancelar() { return new Cancelado(); }
}
class EmAndamento extends EstadoTorneio {
  readonly nome: StatusTorneio = "EM_ANDAMENTO";
  finalizar() { return new Finalizado(); }
  cancelar() { return new Cancelado(); }
}
class Finalizado extends EstadoTorneio {
  readonly nome: StatusTorneio = "FINALIZADO";
}
class Cancelado extends EstadoTorneio {
  readonly nome: StatusTorneio = "CANCELADO";
}

export function estadoDe(status: StatusTorneio): EstadoTorneio {
  switch (status) {
    case "RASCUNHO": return new Rascunho();
    case "INSCRICOES_ABERTAS": return new InscricoesAbertas();
    case "EM_ANDAMENTO": return new EmAndamento();
    case "FINALIZADO": return new Finalizado();
    case "CANCELADO": return new Cancelado();
  }
}
