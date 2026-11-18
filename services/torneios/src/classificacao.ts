import { PartidaChave } from "./chave";

export interface LinhaClassificacao {
  equipeId: string;
  jogos: number; vitorias: number; empates: number; derrotas: number;
  golsPro: number; golsContra: number; saldo: number; pontos: number;
}

/**
 * Padrão GoF: STRATEGY (critérios de desempate intercambiáveis).
 * comparar() < 0 significa que "a" fica na frente de "b".
 */
export interface CriterioDesempate {
  comparar(a: LinhaClassificacao, b: LinhaClassificacao): number;
}
export class PorPontos implements CriterioDesempate { comparar(a: LinhaClassificacao, b: LinhaClassificacao) { return b.pontos - a.pontos; } }
export class PorSaldo implements CriterioDesempate { comparar(a: LinhaClassificacao, b: LinhaClassificacao) { return b.saldo - a.saldo; } }
export class PorGolsPro implements CriterioDesempate { comparar(a: LinhaClassificacao, b: LinhaClassificacao) { return b.golsPro - a.golsPro; } }
/** Último critério: garante resultado determinístico. */
export class PorIdentificador implements CriterioDesempate { comparar(a: LinhaClassificacao, b: LinhaClassificacao) { return a.equipeId.localeCompare(b.equipeId); } }

export const CRITERIOS_PADRAO: CriterioDesempate[] = [new PorPontos(), new PorSaldo(), new PorGolsPro(), new PorIdentificador()];

export function classificar(
  equipes: string[],
  partidas: PartidaChave[],
  criterios: CriterioDesempate[] = CRITERIOS_PADRAO
): LinhaClassificacao[] {
  const tabela = new Map<string, LinhaClassificacao>(
    equipes.map((id) => [id, { equipeId: id, jogos: 0, vitorias: 0, empates: 0, derrotas: 0, golsPro: 0, golsContra: 0, saldo: 0, pontos: 0 }])
  );
  for (const p of partidas) {
    if (p.bye || !p.concluido() || p.equipeB === null) continue;
    const a = tabela.get(p.equipeA)!, b = tabela.get(p.equipeB)!;
    const ga = p.placarA ?? 0, gb = p.placarB ?? 0;
    a.jogos++; b.jogos++;
    a.golsPro += ga; a.golsContra += gb; b.golsPro += gb; b.golsContra += ga;
    if (ga > gb) { a.vitorias++; b.derrotas++; a.pontos += 3; }
    else if (gb > ga) { b.vitorias++; a.derrotas++; b.pontos += 3; }
    else { a.empates++; b.empates++; a.pontos++; b.pontos++; }
  }
  const linhas = [...tabela.values()];
  linhas.forEach((l) => (l.saldo = l.golsPro - l.golsContra));
  return linhas.sort((x, y) => {
    for (const c of criterios) { const r = c.comparar(x, y); if (r !== 0) return r; }
    return 0;
  });
}
