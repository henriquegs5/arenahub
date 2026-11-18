import { estadoDe, StatusPartida } from "./estados";

/**
 * Padrão GoF: COMMAND.
 * Cada ação sobre o resultado (informar, confirmar, contestar, resolver) é um objeto
 * que sabe: quem pode executá-la, o que muda na partida e qual evento gera.
 * O serviço executa o comando e grava no histórico (quem fez o quê, quando).
 */
export interface Partida {
  id: string;
  torneioId: string;
  formato: "ELIMINACAO_SIMPLES" | "PONTOS_CORRIDOS";
  organizadorId: string;
  rodada: number;
  equipeAId: string;
  equipeBId: string;
  capitaoAId: string;
  capitaoBId: string;
  status: StatusPartida;
  placarA: number | null;
  placarB: number | null;
  informadoPor: string | null;
  contestadoPor: string | null;
  motivoContestacao: string | null;
}

export interface EventoSaida { nome: string; payload: unknown; correlationId: string }

export class ErroRegra extends Error {
  constructor(public readonly status: number, mensagem: string) { super(mensagem); }
}

export interface Comando {
  readonly nome: string;
  readonly usuarioId: string;
  dados(): Record<string, unknown>;
  executar(p: Partida, correlationId: string): EventoSaida[];
}

// ---------- regras compartilhadas pelos comandos ----------
function exigirCapitao(p: Partida, usuarioId: string) {
  if (usuarioId !== p.capitaoAId && usuarioId !== p.capitaoBId)
    throw new ErroRegra(403, "somente o capitão de uma das equipes pode fazer isso");
}
function exigirOrganizador(p: Partida, usuarioId: string) {
  if (usuarioId !== p.organizadorId) throw new ErroRegra(403, "somente o organizador do torneio pode fazer isso");
}
function validarPlacar(p: Partida, a: unknown, b: unknown): [number, number] {
  const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 999;
  if (!ok(a) || !ok(b)) throw new ErroRegra(400, "placarA e placarB devem ser inteiros entre 0 e 999");
  if (p.formato === "ELIMINACAO_SIMPLES" && a === b)
    throw new ErroRegra(422, "empate não é permitido em eliminação simples");
  return [a, b];
}
export function vencedorDe(p: Partida): string | null {
  if (p.placarA === null || p.placarB === null || p.placarA === p.placarB) return null;
  return p.placarA > p.placarB ? p.equipeAId : p.equipeBId;
}
const eventoConfirmado = (p: Partida, correlationId: string): EventoSaida => ({
  nome: "resultado.confirmado",
  correlationId,
  payload: {
    partidaId: p.id, torneioId: p.torneioId, rodada: p.rodada,
    equipeAId: p.equipeAId, equipeBId: p.equipeBId,
    placarA: p.placarA, placarB: p.placarB, vencedorId: vencedorDe(p),
  },
});

// ---------- comandos ----------
export class InformarResultado implements Comando {
  readonly nome = "INFORMAR_RESULTADO";
  constructor(readonly usuarioId: string, private placarA: unknown, private placarB: unknown) {}
  dados() { return { placarA: this.placarA, placarB: this.placarB }; }

  executar(p: Partida, correlationId: string) {
    exigirCapitao(p, this.usuarioId);
    const [a, b] = validarPlacar(p, this.placarA, this.placarB);
    p.status = estadoDe(p.status).informar().nome;
    p.placarA = a; p.placarB = b; p.informadoPor = this.usuarioId;
    return [{
      nome: "resultado.informado", correlationId,
      payload: { partidaId: p.id, torneioId: p.torneioId, informadoPor: this.usuarioId, placarA: a, placarB: b },
    }];
  }
}

export class ConfirmarResultado implements Comando {
  readonly nome = "CONFIRMAR_RESULTADO";
  constructor(readonly usuarioId: string) {}
  dados() { return {}; }

  executar(p: Partida, correlationId: string) {
    exigirOrganizador(p, this.usuarioId);
    p.status = estadoDe(p.status).confirmar().nome;
    return [eventoConfirmado(p, correlationId)];
  }
}

export class ContestarResultado implements Comando {
  readonly nome = "CONTESTAR_RESULTADO";
  constructor(readonly usuarioId: string, private motivo: unknown) {}
  dados() { return { motivo: this.motivo }; }

  executar(p: Partida, correlationId: string) {
    exigirCapitao(p, this.usuarioId);
    if (this.usuarioId === p.informadoPor) throw new ErroRegra(403, "quem informou o resultado não pode contestá-lo");
    if (typeof this.motivo !== "string" || this.motivo.trim().length < 3) throw new ErroRegra(400, "informe o motivo da contestação");
    p.status = estadoDe(p.status).contestar().nome;
    p.contestadoPor = this.usuarioId;
    p.motivoContestacao = this.motivo.trim();
    return [{
      nome: "resultado.contestado", correlationId,
      payload: { partidaId: p.id, torneioId: p.torneioId, contestadoPor: this.usuarioId, motivo: p.motivoContestacao },
    }];
  }
}

export class ResolverContestacao implements Comando {
  readonly nome = "RESOLVER_CONTESTACAO";
  constructor(readonly usuarioId: string, private placarA: unknown, private placarB: unknown) {}
  dados() { return { placarA: this.placarA, placarB: this.placarB }; }

  executar(p: Partida, correlationId: string) {
    exigirOrganizador(p, this.usuarioId);
    const [a, b] = validarPlacar(p, this.placarA, this.placarB);
    p.status = estadoDe(p.status).resolver().nome;
    p.placarA = a; p.placarB = b;
    return [eventoConfirmado(p, correlationId)];
  }
}
