import { PoliticaPreco, estrategiaPara } from "./precos";

/**
 * Padrão GoF: COMPOSITE.
 *
 *   EventoComposto (raiz)  →  Setor (composto)  →  Lote (folha)
 *
 * Os três implementam ComponenteEvento, então "qual a capacidade?",
 * "quantos lugares já saíram?" e "quantos ainda há?" são respondidos do mesmo
 * jeito para o evento inteiro, para um setor ou para um único lote. A
 * capacidade do evento é literalmente a soma das partes — não existe um campo
 * `capacidade_total` que possa divergir da estrutura.
 *
 * A capacidade real mora nas FOLHAS (os lotes). Um setor sem lote tem
 * capacidade zero, e por isso o evento só pode ser publicado quando a estrutura
 * tem lugares de verdade.
 */
export interface ComponenteEvento {
  readonly nome: string;
  capacidade(): number;
  reservados(): number;
  disponiveis(): number;
}

/** FOLHA: um lote de ingressos, com preço, política e janela de vigência. */
export class Lote implements ComponenteEvento {
  constructor(
    public readonly id: string,
    public readonly setorId: string,
    public readonly nome: string,
    /** Preço cheio em CENTAVOS. */
    public readonly precoCentavos: number,
    /** Desconto do lote (0 a 100), usado pela política PROMOCIONAL. */
    public readonly descontoPercentual: number,
    /** Política padrão sugerida por este lote. */
    public readonly politicaPadrao: PoliticaPreco,
    private readonly capacidadeLote: number,
    private readonly reservadosLote: number,
    /** Janela de vigência; null = sem limite daquele lado. */
    public readonly inicioVendas: Date | null,
    public readonly fimVendas: Date | null,
    public readonly ativo: boolean
  ) {}

  capacidade() { return this.capacidadeLote; }
  reservados() { return this.reservadosLote; }
  disponiveis() { return Math.max(0, this.capacidadeLote - this.reservadosLote); }

  /** O lote está valendo agora? Lote fora da janela não vende. */
  vigente(agora: Date = new Date()): boolean {
    if (!this.ativo) return false;
    if (this.inicioVendas && agora < this.inicioVendas) return false;
    if (this.fimVendas && agora > this.fimVendas) return false;
    return true;
  }

  /** Preço unitário em centavos para a política pedida (Strategy). */
  precoUnitario(politica: PoliticaPreco = this.politicaPadrao): number {
    return estrategiaPara(politica).precoUnitario(this.precoCentavos, this.descontoPercentual);
  }
}

/** COMPOSTO: um setor do local (Pista, Arquibancada, Camarote), que agrupa lotes. */
export class Setor implements ComponenteEvento {
  private readonly lotes: Lote[] = [];

  constructor(
    public readonly id: string,
    public readonly eventoId: string,
    public readonly nome: string,
    public readonly descricao: string | null
  ) {}

  adicionar(lote: Lote): this { this.lotes.push(lote); return this; }
  filhos(): Lote[] { return [...this.lotes]; }

  capacidade() { return this.lotes.reduce((t, l) => t + l.capacidade(), 0); }
  reservados() { return this.lotes.reduce((t, l) => t + l.reservados(), 0); }
  disponiveis() { return this.lotes.reduce((t, l) => t + l.disponiveis(), 0); }

  /** Lotes que podem vender agora. */
  lotesVigentes(agora: Date = new Date()): Lote[] {
    return this.lotes.filter((l) => l.vigente(agora) && l.disponiveis() > 0);
  }

  /** Menor preço praticado no setor, para o cartão do catálogo. */
  precoMinimo(agora: Date = new Date()): number | null {
    const precos = this.lotesVigentes(agora).map((l) => l.precoUnitario());
    return precos.length ? Math.min(...precos) : null;
  }
}

/** COMPOSTO RAIZ: o evento, que agrupa setores. */
export class EventoComposto implements ComponenteEvento {
  private readonly setores: Setor[] = [];

  constructor(public readonly id: string, public readonly nome: string) {}

  adicionar(setor: Setor): this { this.setores.push(setor); return this; }
  filhos(): Setor[] { return [...this.setores]; }

  capacidade() { return this.setores.reduce((t, s) => t + s.capacidade(), 0); }
  reservados() { return this.setores.reduce((t, s) => t + s.reservados(), 0); }
  disponiveis() { return this.setores.reduce((t, s) => t + s.disponiveis(), 0); }

  precoMinimo(agora: Date = new Date()): number | null {
    const precos = this.setores.map((s) => s.precoMinimo(agora)).filter((p): p is number => p !== null);
    return precos.length ? Math.min(...precos) : null;
  }

  /** Acha um lote em qualquer setor, sem o chamador percorrer a árvore. */
  acharLote(loteId: string): Lote | null {
    for (const s of this.setores) {
      const l = s.filhos().find((x) => x.id === loteId);
      if (l) return l;
    }
    return null;
  }

  /** Monta a árvore a partir das linhas do banco. */
  static montar(
    evento: { id: string; nome: string },
    setores: { id: string; eventoId: string; nome: string; descricao: string | null }[],
    lotes: Lote[]
  ): EventoComposto {
    const raiz = new EventoComposto(evento.id, evento.nome);
    for (const s of setores) {
      const setor = new Setor(s.id, s.eventoId, s.nome, s.descricao);
      for (const l of lotes.filter((x) => x.setorId === s.id)) setor.adicionar(l);
      raiz.adicionar(setor);
    }
    return raiz;
  }
}
