import { Chave, PartidaBye, PartidaChave, Rodada } from "./chave";
import { classificar } from "./classificacao";

export type Formato = "ELIMINACAO_SIMPLES" | "PONTOS_CORRIDOS";
export const FORMATOS: Formato[] = ["ELIMINACAO_SIMPLES", "PONTOS_CORRIDOS"];

/**
 * Padrão GoF: STRATEGY. Cada formato de torneio é uma estratégia plugável
 * para gerar confrontos, avançar de fase e apontar o campeão.
 */
export interface EstrategiaFormato {
  gerarChaveInicial(equipes: string[]): Chave;
  /** Próxima rodada, se a atual terminou e o torneio continua; senão null. */
  avancar(chave: Chave): Rodada | null;
  terminou(chave: Chave): boolean;
  campeao(chave: Chave): string;
}

// ---------- Eliminação simples ----------
const potenciaDe2 = (n: number) => { let p = 1; while (p < n) p *= 2; return p; };

function rodadaEliminatoria(numero: number, equipes: string[]): Rodada {
  const byes = potenciaDe2(equipes.length) - equipes.length; // quem avança sem jogar
  const rodada = new Rodada(numero);
  let ordem = 0;
  for (let i = 0; i < byes; i++) rodada.adicionar(new PartidaBye(numero, ordem++, equipes[i]));
  for (let i = byes; i < equipes.length; i += 2) rodada.adicionar(PartidaChave.nova(numero, ordem++, equipes[i], equipes[i + 1]));
  return rodada;
}

export class EliminacaoSimples implements EstrategiaFormato {
  gerarChaveInicial(equipes: string[]) { return new Chave().adicionar(rodadaEliminatoria(1, equipes)); }

  avancar(chave: Chave) {
    const ultima = chave.ultimaRodada();
    if (!ultima.concluido()) return null;
    const vencedores = ultima.vencedores();
    return vencedores.length <= 1 ? null : rodadaEliminatoria(ultima.numero + 1, vencedores);
  }

  terminou(chave: Chave) {
    const ultima = chave.ultimaRodada();
    return ultima.concluido() && ultima.vencedores().length === 1;
  }

  campeao(chave: Chave) { return chave.ultimaRodada().vencedores()[0]; }
}

// ---------- Pontos corridos (todos contra todos, turno único) ----------
export class PontosCorridos implements EstrategiaFormato {
  /** Método do círculo: gera todas as rodadas de uma vez. */
  gerarChaveInicial(equipes: string[]) {
    const lista: (string | null)[] = [...equipes];
    if (lista.length % 2 === 1) lista.push(null); // folga
    const m = lista.length;
    const chave = new Chave();
    for (let r = 0; r < m - 1; r++) {
      const rodada = new Rodada(r + 1);
      let ordem = 0;
      for (let i = 0; i < m / 2; i++) {
        const a = lista[i], b = lista[m - 1 - i];
        if (a !== null && b !== null) rodada.adicionar(PartidaChave.nova(r + 1, ordem++, a, b));
      }
      chave.adicionar(rodada);
      lista.splice(1, 0, lista.pop()!); // rotaciona mantendo o primeiro fixo
    }
    return chave;
  }

  avancar() { return null; } // todas as rodadas já existem
  terminou(chave: Chave) { return chave.concluido(); }

  campeao(chave: Chave) {
    const partidas = chave.partidas();
    const equipes = [...new Set(partidas.flatMap((p) => [p.equipeA, p.equipeB!]))];
    return classificar(equipes, partidas)[0].equipeId;
  }
}

/**
 * Padrão GoF: FACTORY METHOD.
 * O criador declara criarEstrategia(); cada subclasse decide qual estratégia instanciar.
 */
export abstract class CriadorTorneio {
  abstract criarEstrategia(): EstrategiaFormato;
}
export class CriadorEliminacaoSimples extends CriadorTorneio {
  criarEstrategia(): EstrategiaFormato { return new EliminacaoSimples(); }
}
export class CriadorPontosCorridos extends CriadorTorneio {
  criarEstrategia(): EstrategiaFormato { return new PontosCorridos(); }
}

export function criadorPara(formato: Formato): CriadorTorneio {
  return formato === "ELIMINACAO_SIMPLES" ? new CriadorEliminacaoSimples() : new CriadorPontosCorridos();
}
