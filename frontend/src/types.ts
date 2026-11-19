/**
 * Tipos do domínio, espelhando o que a API devolve.
 *
 * O backend é a autoridade sobre permissões: esconder um botão aqui só evita
 * oferecer o que vai ser recusado — nunca é controle de acesso.
 */

export type Papel = "PARTICIPANTE" | "ORGANIZADOR" | "ADM";

export const ROTULO_PAPEL: Record<Papel, string> = {
  PARTICIPANTE: "Participante",
  ORGANIZADOR: "Organizador",
  ADM: "Administrador",
};

export interface Usuario {
  id: string;
  nome: string;
  papel: Papel;
  email?: string;
  criadoEm?: string;
}

// ---------- eventos ----------

export type StatusEvento =
  | "RASCUNHO" | "PUBLICADO" | "VENDAS_ABERTAS"
  | "VENDAS_ENCERRADAS" | "REALIZADO" | "CANCELADO";

export type PoliticaPreco = "INTEIRA" | "MEIA" | "PROMOCIONAL" | "CORTESIA";

export interface Lote {
  id: string;
  nome: string;
  precoCentavos: number;
  precoFormatado: string;
  descontoPercentual: number;
  politicaPadrao: PoliticaPreco;
  capacidade: number;
  reservados: number;
  disponiveis: number;
  inicioVendas: string | null;
  fimVendas: string | null;
  ativo: boolean;
  vigente: boolean;
}

export interface Setor {
  id: string;
  nome: string;
  descricao: string | null;
  capacidade: number;
  reservados: number;
  disponiveis: number;
  lotes: Lote[];
}

/** Resumo devolvido pelo catálogo: já traz os agregados do Composite. */
export interface EventoResumo {
  id: string;
  nome: string;
  descricao: string | null;
  dataHora: string;
  local: string;
  status: StatusEvento;
  organizadorId: string;
  motivoCancelamento: string | null;
  capacidade: number;
  reservados: number;
  disponiveis: number;
  precoMinimoCentavos: number | null;
  setores: number;
}

/** Detalhe: a árvore inteira de setores e lotes. */
export interface EventoDetalhe extends Omit<EventoResumo, "setores"> {
  setores: Setor[];
}

// ---------- pedidos e ingressos ----------

export type StatusPedido =
  | "PENDENTE" | "RESERVADO" | "AGUARDANDO_PAGAMENTO" | "PAGO"
  | "CONCLUIDO" | "RECUSADO" | "EXPIRADO" | "CANCELADO";

export type StatusIngresso = "EMITIDO" | "UTILIZADO" | "CANCELADO" | "INVALIDADO";

export type MeioPagamento = "PIX" | "CARTAO_CREDITO" | "BOLETO" | "CARTAO_RECUSADO";

export interface Ingresso {
  id: string;
  pedidoId: string;
  eventoId: string;
  titularId: string;
  codigo: string;
  setorNome: string | null;
  loteNome: string | null;
  politica: string;
  precoCentavos: number;
  preco: string;
  status: StatusIngresso;
  eventoNome: string | null;
  eventoDataHora: string | null;
  eventoLocal: string | null;
  emitidoEm: string;
  validadoEm: string | null;
  validadoPor: string | null;
}

export interface ItemPedido {
  loteId: string;
  setorNome: string | null;
  loteNome: string | null;
  quantidade: number;
  politica: string;
  precoUnitarioCentavos: number;
  precoUnitario: string;
}

export interface Pedido {
  id: string;
  eventoId: string;
  compradorId: string;
  status: StatusPedido;
  emAndamento: boolean;
  podeCancelar: boolean;
  totalCentavos: number;
  total: string;
  meio: string;
  motivo: string | null;
  eventoNome: string | null;
  eventoDataHora: string | null;
  eventoLocal: string | null;
  expiraEm: string;
  criadoEm: string;
  atualizadoEm: string;
  itens: ItemPedido[];
  ingressos: Ingresso[];
}

export interface LinhaHistorico {
  id: string;
  pedidoId: string;
  comando: string;
  autorId: string | null;
  dados: Record<string, unknown>;
  statusApos: string;
  executadoEm: string;
}

export interface ResultadoValidacao {
  aprovado: boolean;
  motivo: string | null;
  ingresso: Ingresso | null;
}

// ---------- pagamento ----------

export type StatusTransacao = "APROVADO" | "RECUSADO" | "ESTORNADO";

export interface Transacao {
  id: string;
  pedidoId: string;
  compradorId: string;
  valorCentavos: number;
  valor: string;
  meio: MeioPagamento;
  meioRotulo: string;
  referenciaPagamento: string;
  status: StatusTransacao;
  autorizacao: string | null;
  motivo: string | null;
  criadoEm: string;
  estornadoEm: string | null;
}

export interface MeioInfo {
  valor: MeioPagamento;
  rotulo: string;
  limiteCentavos: number;
  aceitaEstorno: boolean;
  recusaSempre: boolean;
}

export interface GatilhoRecusa {
  gatilho: string;
  comoProvocar: string;
  efeito: string;
}

export interface MeiosPagamento {
  meios: MeioInfo[];
  gatilhosDeRecusa: GatilhoRecusa[];
}

export interface RegrasCompra {
  meios: MeioPagamento[];
  limitePorComprador: number;
  pedidoExpiraSegundos: number;
}

// ---------- notificações ----------

export interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  usuarioId: string | null;
  eventoId: string | null;
  pedidoId: string | null;
  ingressoId: string | null;
  criadoEm: string;
  lidaEm: string | null;
  lida: boolean;
}

// ---------- infraestrutura ----------

export interface StatusServico { servico: string; circuito: string }

export interface MensagemDLQ {
  eventId: string;
  type: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  producer: string;
  payload: unknown;
}

export interface RespostaDLQ { total: number; mensagens: MensagemDLQ[] }

/** Dados e utilidades compartilhados por todas as telas. */
export interface Ctx {
  eu: Usuario;
  usuarios: Usuario[];
  nomeUsuario: (id?: string | null) => string;
  recarregar: () => Promise<void>;
  /** Atualiza o contador de avisos do cabeçalho. */
  avisarMudanca: () => void;
}
