import { ReactNode } from "react";

export const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: "Rascunho", INSCRICOES_ABERTAS: "Inscrições abertas", EM_ANDAMENTO: "Em andamento",
  FINALIZADO: "Finalizado", CANCELADO: "Cancelado",
  PENDENTE: "Pendente", CONFIRMADA: "Confirmada", REJEITADA: "Rejeitada",
  AGENDADA: "Agendada", RESULTADO_INFORMADO: "Resultado informado", CONTESTADA: "Contestada",
};
export const ROTULO_FORMATO: Record<string, string> = {
  ELIMINACAO_SIMPLES: "Eliminação simples", PONTOS_CORRIDOS: "Pontos corridos",
};

const COR: Record<string, string> = {
  RASCUNHO: "cinza", INSCRICOES_ABERTAS: "azul", EM_ANDAMENTO: "amarelo", FINALIZADO: "verde", CANCELADO: "vermelho",
  PENDENTE: "amarelo", CONFIRMADA: "verde", REJEITADA: "vermelho",
  AGENDADA: "cinza", RESULTADO_INFORMADO: "azul", CONTESTADA: "vermelho",
};

export const Badge = ({ status }: { status: string }) => (
  <span className={`badge ${COR[status] ?? "cinza"}`}>{ROTULO_STATUS[status] ?? status}</span>
);

export const Alerta = ({ texto, tipo = "erro" }: { texto: string | null; tipo?: "erro" | "info" }) =>
  texto ? <div className={`alerta ${tipo}`}>{texto}</div> : null;

export const Secao = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <section className="card"><h3>{titulo}</h3>{children}</section>
);

export const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR");
