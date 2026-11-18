import { randomUUID } from "node:crypto";

/**
 * Padrão GoF: COMPOSITE.
 * Chave (composite) → Rodada (composite) → PartidaChave / PartidaBye (folhas).
 * Todos expõem a mesma interface, então "a rodada acabou?" e "quem avançou?"
 * são respondidos do mesmo jeito para uma partida, uma rodada ou a chave inteira.
 */
export type StatusPartida = "AGENDADA" | "CONFIRMADA";

export interface ComponenteChave {
  concluido(): boolean;
  vencedores(): string[];
  partidas(): PartidaChave[];
}

/** Folha: uma partida entre duas equipes. */
export class PartidaChave implements ComponenteChave {
  constructor(
    public readonly id: string,
    public readonly rodada: number,
    public readonly ordem: number,
    public readonly equipeA: string,
    public readonly equipeB: string | null,
    public readonly bye: boolean,
    public status: StatusPartida = "AGENDADA",
    public placarA: number | null = null,
    public placarB: number | null = null,
    public vencedorId: string | null = null
  ) {}

  static nova(rodada: number, ordem: number, equipeA: string, equipeB: string): PartidaChave {
    return new PartidaChave(randomUUID(), rodada, ordem, equipeA, equipeB, false);
  }

  registrar(placarA: number, placarB: number, vencedorId: string | null): void {
    this.placarA = placarA;
    this.placarB = placarB;
    this.vencedorId = vencedorId;
    this.status = "CONFIRMADA";
  }

  concluido() { return this.status === "CONFIRMADA"; }
  vencedores() { return this.vencedorId ? [this.vencedorId] : []; }
  partidas() { return [this]; }
}

/** Folha especial: equipe que avança sem jogar (quando o nº de equipes não é potência de 2). */
export class PartidaBye extends PartidaChave {
  constructor(rodada: number, ordem: number, equipe: string) {
    super(randomUUID(), rodada, ordem, equipe, null, true, "CONFIRMADA", null, null, equipe);
  }
}

/** Composite: agrupa as partidas de uma rodada. */
export class Rodada implements ComponenteChave {
  private filhos: ComponenteChave[] = [];
  constructor(public readonly numero: number) {}

  adicionar(c: ComponenteChave): this { this.filhos.push(c); return this; }
  concluido() { return this.filhos.length > 0 && this.filhos.every((f) => f.concluido()); }
  vencedores() { return this.filhos.flatMap((f) => f.vencedores()); }
  partidas() { return this.filhos.flatMap((f) => f.partidas()); }
}

/** Composite raiz: todas as rodadas do torneio. */
export class Chave implements ComponenteChave {
  private rodadas: Rodada[] = [];

  adicionar(r: Rodada): this { this.rodadas.push(r); return this; }
  listaRodadas(): Rodada[] { return [...this.rodadas]; }
  ultimaRodada(): Rodada { return this.rodadas[this.rodadas.length - 1]; }
  concluido() { return this.rodadas.length > 0 && this.rodadas.every((r) => r.concluido()); }
  vencedores() { return this.ultimaRodada().vencedores(); }
  partidas() { return this.rodadas.flatMap((r) => r.partidas()); }

  /** Reconstrói a chave a partir das partidas gravadas no banco. */
  static deRegistros(registros: PartidaChave[]): Chave {
    const porRodada = new Map<number, PartidaChave[]>();
    for (const p of registros) porRodada.set(p.rodada, [...(porRodada.get(p.rodada) ?? []), p]);
    const chave = new Chave();
    [...porRodada.keys()].sort((a, b) => a - b).forEach((n) => {
      const rodada = new Rodada(n);
      porRodada.get(n)!.sort((a, b) => a.ordem - b.ordem).forEach((p) => rodada.adicionar(p));
      chave.adicionar(rodada);
    });
    return chave;
  }
}
