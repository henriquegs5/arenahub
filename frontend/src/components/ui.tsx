import { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, LucideIcon } from "lucide-react";

/**
 * Rótulos das máquinas de estado do domínio de ingressos.
 * Evento: RASCUNHO → PUBLICADO → VENDAS_ABERTAS → VENDAS_ENCERRADAS → REALIZADO
 * Pedido: PENDENTE → RESERVADO → PAGO → CONCLUIDO (ou CANCELADO)
 * Ingresso: EMITIDO → UTILIZADO (ou CANCELADO / INVALIDADO)
 */
export const ROTULO_STATUS: Record<string, string> = {
  // evento
  RASCUNHO: "Rascunho", PUBLICADO: "Publicado", VENDAS_ABERTAS: "Vendas abertas",
  VENDAS_ENCERRADAS: "Vendas encerradas", REALIZADO: "Realizado", CANCELADO: "Cancelado",
  // pedido
  PENDENTE: "Processando", RESERVADO: "Lugares reservados", AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  PAGO: "Pago", CONCLUIDO: "Concluído", RECUSADO: "Pagamento recusado", EXPIRADO: "Expirado",
  // ingresso
  EMITIDO: "Emitido", UTILIZADO: "Utilizado", INVALIDADO: "Invalidado",
  // pagamento
  APROVADO: "Aprovado", ESTORNADO: "Estornado",
};

type Cor = "neutro" | "azul" | "vermelho" | "verde" | "ambar";
const COR_STATUS: Record<string, Cor> = {
  RASCUNHO: "neutro", PUBLICADO: "azul", VENDAS_ABERTAS: "verde",
  VENDAS_ENCERRADAS: "neutro", REALIZADO: "neutro", CANCELADO: "vermelho",
  PENDENTE: "ambar", RESERVADO: "ambar", AGUARDANDO_PAGAMENTO: "ambar",
  PAGO: "verde", CONCLUIDO: "verde", RECUSADO: "vermelho", EXPIRADO: "vermelho",
  EMITIDO: "verde", UTILIZADO: "azul", INVALIDADO: "vermelho",
  APROVADO: "verde", ESTORNADO: "ambar",
};
const PULSANTES = new Set(["PENDENTE", "RESERVADO", "AGUARDANDO_PAGAMENTO"]);

export function Selo({ status, texto }: { status: string; texto?: string }) {
  return (
    <span className={`selo ${COR_STATUS[status] ?? "neutro"}`}>
      {PULSANTES.has(status) && <i className="pulso" />}
      {texto ?? ROTULO_STATUS[status] ?? status}
    </span>
  );
}

/** Iniciais de um nome, usadas como escudo/avatar enquanto não há imagem. */
export const iniciais = (nome: string) =>
  nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase() || "?";

export const Escudo = ({ nome, tam = "" }: { nome: string; tam?: "g" | "p" | "" }) => (
  <span className={`escudo ${tam}`} aria-hidden="true">{iniciais(nome)}</span>
);

export function Stat({ icone: Icone, cor, valor, rotulo }: { icone: LucideIcon; cor: string; valor: ReactNode; rotulo: string }) {
  return (
    <div className="stat">
      <span className={`icone ${cor}`}><Icone size={18} /></span>
      <div>
        <div className="valor">{valor}</div>
        <div className="rotulo">{rotulo}</div>
      </div>
    </div>
  );
}

export function Alerta({ texto, tipo = "erro" }: { texto: string | null; tipo?: "erro" | "info" | "ok" }) {
  if (!texto) return null;
  const Icone = tipo === "erro" ? AlertTriangle : tipo === "ok" ? CheckCircle2 : Info;
  return <div className={`alerta ${tipo}`} role={tipo === "erro" ? "alert" : "status"}><Icone size={16} />{texto}</div>;
}

export function Vazio({ icone: Icone, titulo, texto, acao }: { icone: LucideIcon; titulo: string; texto: string; acao?: ReactNode }) {
  return (
    <div className="vazio">
      <div className="icone"><Icone size={22} /></div>
      <h3>{titulo}</h3>
      <p>{texto}</p>
      {acao && <div className="acao">{acao}</div>}
    </div>
  );
}

export function PaginaTopo({ titulo, descricao, acoes }: { titulo: string; descricao: string; acoes?: ReactNode }) {
  return (
    <div className="pagina-topo">
      <div>
        <h1>{titulo}</h1>
        <p className="descricao">{descricao}</p>
      </div>
      {acoes && <div className="acoes">{acoes}</div>}
    </div>
  );
}

export function Confirmacao(
  { titulo, texto, rotuloConfirmar, perigo, aoConfirmar, aoCancelar }:
  { titulo: string; texto: string; rotuloConfirmar: string; perigo?: boolean; aoConfirmar: () => void; aoCancelar: () => void }
) {
  return (
    <div className="fundo-modal" role="dialog" aria-modal="true" onClick={aoCancelar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{titulo}</h3>
        <p>{texto}</p>
        <div className="botoes">
          <button className="b-secundario" onClick={aoCancelar}>Voltar</button>
          <button className={perigo ? "b-perigo" : "b-primario"} onClick={aoConfirmar}>{rotuloConfirmar}</button>
        </div>
      </div>
    </div>
  );
}

export const Girando = () => <Loader2 size={15} className="girando" />;

export const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
export function desde(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
