export interface ResultadoPartida {
  partidaId: string; torneioId: string; equipeAId: string; equipeBId: string;
  placarA: number; placarB: number; vencedorId: string | null;
}

export interface LinhaRanking {
  posicao: number; equipeId: string; nome: string | null;
  jogos: number; vitorias: number; empates: number; derrotas: number;
  golsPro: number; golsContra: number; saldo: number; pontos: number; titulos: number;
}

/**
 * Padrão GoF: STRATEGY (critérios de ordenação intercambiáveis).
 * A classificação de um torneio e o ranking geral usam listas diferentes de critérios.
 * comparar() < 0 significa que "a" fica na frente de "b".
 * (Regra mantida só neste serviço: não há código compartilhado entre serviços.)
 */
export interface CriterioDesempate { comparar(a: LinhaRanking, b: LinhaRanking): number }
export class PorPontos implements CriterioDesempate { comparar(a: LinhaRanking, b: LinhaRanking) { return b.pontos - a.pontos; } }
export class PorTitulos implements CriterioDesempate { comparar(a: LinhaRanking, b: LinhaRanking) { return b.titulos - a.titulos; } }
export class PorSaldo implements CriterioDesempate { comparar(a: LinhaRanking, b: LinhaRanking) { return b.saldo - a.saldo; } }
export class PorGolsPro implements CriterioDesempate { comparar(a: LinhaRanking, b: LinhaRanking) { return b.golsPro - a.golsPro; } }
export class PorIdentificador implements CriterioDesempate { comparar(a: LinhaRanking, b: LinhaRanking) { return a.equipeId.localeCompare(b.equipeId); } }

export const CRITERIOS_TORNEIO: CriterioDesempate[] = [new PorPontos(), new PorSaldo(), new PorGolsPro(), new PorIdentificador()];
export const CRITERIOS_GERAL: CriterioDesempate[] = [new PorPontos(), new PorTitulos(), new PorSaldo(), new PorIdentificador()];

export function classificar(
  equipes: string[],
  resultados: ResultadoPartida[],
  nomes: Map<string, string>,
  titulos: Map<string, number>,
  criterios: CriterioDesempate[]
): LinhaRanking[] {
  const tabela = new Map<string, LinhaRanking>();
  const linha = (id: string) => {
    if (!tabela.has(id))
      tabela.set(id, { posicao: 0, equipeId: id, nome: nomes.get(id) ?? null, jogos: 0, vitorias: 0, empates: 0, derrotas: 0, golsPro: 0, golsContra: 0, saldo: 0, pontos: 0, titulos: titulos.get(id) ?? 0 });
    return tabela.get(id)!;
  };
  equipes.forEach(linha);

  for (const r of resultados) {
    const a = linha(r.equipeAId), b = linha(r.equipeBId);
    a.jogos++; b.jogos++;
    a.golsPro += r.placarA; a.golsContra += r.placarB;
    b.golsPro += r.placarB; b.golsContra += r.placarA;
    if (r.placarA > r.placarB) { a.vitorias++; b.derrotas++; a.pontos += 3; }
    else if (r.placarB > r.placarA) { b.vitorias++; a.derrotas++; b.pontos += 3; }
    else { a.empates++; b.empates++; a.pontos++; b.pontos++; }
  }

  const linhas = [...tabela.values()];
  linhas.forEach((l) => (l.saldo = l.golsPro - l.golsContra));
  linhas.sort((x, y) => {
    for (const c of criterios) { const r = c.comparar(x, y); if (r !== 0) return r; }
    return 0;
  });
  linhas.forEach((l, i) => (l.posicao = i + 1));
  return linhas;
}
