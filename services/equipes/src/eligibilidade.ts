import { TAMANHO_MAX, TAMANHO_MIN } from "./config";
import { Equipe } from "./repositorio";

/**
 * Padrão GoF: CHAIN OF RESPONSIBILITY.
 * Cada elo verifica UMA regra de elegibilidade e, se passar, repassa ao próximo.
 * O primeiro elo que reprovar interrompe a cadeia e devolve o motivo.
 */
export interface ContextoValidacao {
  equipe: Equipe | null;
  membros: string[];
  solicitanteId: string;
}

export abstract class ValidadorElegibilidade {
  private proximo?: ValidadorElegibilidade;

  encadear(proximo: ValidadorElegibilidade): ValidadorElegibilidade {
    this.proximo = proximo;
    return proximo;
  }

  /** Retorna null se elegível, ou o motivo da reprovação. */
  validar(ctx: ContextoValidacao): string | null {
    const motivo = this.verificar(ctx);
    if (motivo) return motivo;
    return this.proximo ? this.proximo.validar(ctx) : null;
  }

  protected abstract verificar(ctx: ContextoValidacao): string | null;
}

export class EquipeExiste extends ValidadorElegibilidade {
  protected verificar(ctx: ContextoValidacao) {
    return ctx.equipe ? null : "equipe não encontrada";
  }
}

export class SolicitanteECapitao extends ValidadorElegibilidade {
  protected verificar(ctx: ContextoValidacao) {
    return ctx.equipe!.capitaoId === ctx.solicitanteId ? null : "somente o capitão pode inscrever a equipe";
  }
}

export class EquipeCompleta extends ValidadorElegibilidade {
  protected verificar(ctx: ContextoValidacao) {
    const n = ctx.membros.length;
    if (n < TAMANHO_MIN) return `equipe incompleta (${n} de no mínimo ${TAMANHO_MIN} membros)`;
    if (n > TAMANHO_MAX) return `equipe excede o máximo de ${TAMANHO_MAX} membros`;
    return null;
  }
}

/** Monta a cadeia na ordem em que as regras devem ser avaliadas. */
export function montarCadeia(): ValidadorElegibilidade {
  const inicio = new EquipeExiste();
  inicio.encadear(new SolicitanteECapitao()).encadear(new EquipeCompleta());
  return inicio;
}
