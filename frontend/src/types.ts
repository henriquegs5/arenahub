export type Papel = "JOGADOR" | "ORGANIZADOR";
export type Formato = "ELIMINACAO_SIMPLES" | "PONTOS_CORRIDOS";

export interface Usuario { id: string; nome: string; papel: Papel; email?: string }
export interface Equipe { id: string; nome: string; capitaoId: string; membros: string[] }

export interface Torneio {
  id: string; nome: string; formato: Formato; maxEquipes: number;
  status: string; organizadorId: string; campeaoId: string | null;
}
export interface Inscricao {
  id: string; torneioId: string; equipeId: string; solicitanteId: string;
  status: string; motivo: string | null; nomeEquipe: string | null;
}
export interface PartidaChave {
  partidaId: string; ordem: number; equipeA: string; equipeB: string | null; bye: boolean;
  status: string; placarA: number | null; placarB: number | null; vencedorId: string | null;
}
export interface RodadaChave { rodada: number; partidas: PartidaChave[] }

export interface Historico { comando: string; usuarioId: string; dados: Record<string, unknown>; statusApos: string; executadoEm: string }
export interface Partida {
  id: string; torneioId: string; formato: Formato; organizadorId: string; rodada: number;
  equipeAId: string; equipeBId: string; capitaoAId: string; capitaoBId: string;
  status: string; placarA: number | null; placarB: number | null;
  informadoPor: string | null; contestadoPor: string | null; motivoContestacao: string | null;
  historico?: Historico[];
}
export interface LinhaRanking {
  posicao: number; equipeId: string; nome: string | null;
  jogos: number; vitorias: number; empates: number; derrotas: number;
  golsPro: number; golsContra: number; saldo: number; pontos: number; titulos: number;
}
export interface Notificacao { id: string; tipo: string; titulo: string; mensagem: string; criadoEm: string }
export interface StatusServico { servico: string; circuito: string }

/** Dados e utilidades compartilhados por todas as telas. */
export interface Ctx {
  eu: Usuario;
  usuarios: Usuario[];
  equipes: Equipe[];
  nomeUsuario: (id?: string | null) => string;
  nomeEquipe: (id?: string | null) => string;
  nomeTorneio: (id?: string | null) => string;
  recarregar: () => Promise<void>;
}
