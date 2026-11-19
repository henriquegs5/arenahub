import { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, LucideIcon } from "lucide-react";

/**
 * Rótulos das máquinas de estado do domínio de ingressos.
 * Evento:   RASCUNHO → PUBLICADO → VENDAS_ABERTAS → VENDAS_ENCERRADAS → REALIZADO
 * Pedido:   PENDENTE → RESERVADO → AGUARDANDO_PAGAMENTO → PAGO → CONCLUIDO
 * Ingresso: EMITIDO → UTILIZADO (ou CANCELADO / INVALIDADO)
 */
export const ROTULO_STATUS: Record<string, string> = {
  // evento
  RASCUNHO: "Rascunho", PUBLICADO: "Publicado", VENDAS_ABERTAS: "Vendas abertas",
  VENDAS_ENCERRADAS: "Vendas encerradas", REALIZADO: "Realizado", CANCELADO: "Cancelado",
  // pedido
  PENDENTE: "Processando", RESERVADO: "Lugares reservados", AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  PAGO: "Pago", CONCLUIDO: "Concluído", RECUSADO: "Recusado", EXPIRADO: "Expirado",
  // ingresso
  EMITIDO: "Válido", UTILIZADO: "Utilizado", INVALIDADO: "Invalidado",
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

/** Estados em movimento ganham um ponto pulsante: a Saga ainda está rodando. */
const PULSANTES = new Set(["PENDENTE", "RESERVADO", "AGUARDANDO_PAGAMENTO", "PAGO"]);

export function Selo({ status, texto }: { status: string; texto?: string }) {
  return (
    <span className={`selo ${COR_STATUS[status] ?? "neutro"}`}>
      {PULSANTES.has(status) && <i className="pulso" />}
      {texto ?? ROTULO_STATUS[status] ?? status}
    </span>
  );
}

export const ROTULO_POLITICA: Record<string, string> = {
  INTEIRA: "Inteira", MEIA: "Meia-entrada", PROMOCIONAL: "Promocional", CORTESIA: "Cortesia",
};

export const ROTULO_MEIO: Record<string, string> = {
  PIX: "Pix",
  CARTAO_CREDITO: "Cartão de crédito",
  BOLETO: "Boleto",
  CARTAO_RECUSADO: "Cartão de teste (recusa sempre)",
};

/** Comandos do histórico do pedido, em português legível. */
export const ROTULO_COMANDO: Record<string, string> = {
  SOLICITAR_COMPRA: "Compra solicitada",
  RESERVAR_LUGARES: "Lugares reservados",
  SOLICITAR_PAGAMENTO: "Cobrança solicitada",
  EMITIR_INGRESSOS: "Ingressos emitidos",
  RECUSAR_PAGAMENTO: "Pagamento recusado",
  RECUSAR_RESERVA: "Reserva recusada",
  EXPIRAR: "Pedido expirado",
  CANCELAR: "Pedido cancelado",
  CANCELAR_EVENTO_CANCELADO: "Evento cancelado",
  CANCELAR_INGRESSO: "Ingresso cancelado",
  VALIDAR_ENTRADA: "Entrada validada",
  ESTORNO_CONCLUIDO: "Estorno concluído",
  ESTORNAR_PAGAMENTO_TARDIO: "Estorno de cobrança tardia",
  DEVOLVER_RESERVA_TARDIA: "Devolução de reserva tardia",
};

// ---------- formatação ----------

/** Centavos inteiros → moeda brasileira. Nunca faz conta em ponto flutuante. */
export const emReais = (centavos: number | null | undefined): string =>
  typeof centavos === "number"
    ? (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";

export const dataHora = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export const dataLonga = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
};

/** Valor para um <input type="datetime-local">, no fuso do navegador. */
export const paraInputDataHora = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function desde(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/** Quanto falta até `iso`. Devolve null quando já passou. */
export function restante(iso: string): string | null {
  const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return null;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)} min`;
}

export const iniciais = (nome: string) =>
  nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase() || "?";

export const Escudo = ({ nome, tam = "" }: { nome: string; tam?: "g" | "p" | "" }) => (
  <span className={`escudo ${tam}`} aria-hidden="true">{iniciais(nome)}</span>
);

// ---------- blocos ----------

export function Stat(
  { icone: Icone, cor, valor, rotulo }:
  { icone: LucideIcon; cor: string; valor: ReactNode; rotulo: string }
) {
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
  return (
    <div className={`alerta ${tipo}`} role={tipo === "erro" ? "alert" : "status"}>
      <Icone size={16} />{texto}
    </div>
  );
}

export function Vazio(
  { icone: Icone, titulo, texto, acao }:
  { icone: LucideIcon; titulo: string; texto: string; acao?: ReactNode }
) {
  return (
    <div className="vazio">
      <div className="icone"><Icone size={22} /></div>
      <h3>{titulo}</h3>
      <p>{texto}</p>
      {acao && <div className="acao">{acao}</div>}
    </div>
  );
}

export function PaginaTopo(
  { titulo, descricao, acoes }:
  { titulo: string; descricao: string; acoes?: ReactNode }
) {
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
  { titulo, texto, rotuloConfirmar, perigo, ocupado, aoConfirmar, aoCancelar }:
  {
    titulo: string; texto: string; rotuloConfirmar: string; perigo?: boolean;
    ocupado?: boolean; aoConfirmar: () => void; aoCancelar: () => void;
  }
) {
  return (
    <div className="fundo-modal" role="dialog" aria-modal="true" onClick={aoCancelar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{titulo}</h3>
        <p>{texto}</p>
        <div className="botoes">
          <button className="b-secundario" onClick={aoCancelar} disabled={ocupado}>Voltar</button>
          <button className={perigo ? "b-perigo" : "b-primario"} onClick={aoConfirmar} disabled={ocupado}>
            {ocupado && <Girando />}{rotuloConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}

export const Girando = () => <Loader2 size={15} className="girando" />;

/** Esqueleto de carregamento, no lugar de uma tela em branco. */
export const Carregando = ({ linhas = 3 }: { linhas?: number }) => (
  <div className="col" style={{ gap: 10 }} aria-busy="true" aria-label="Carregando">
    {Array.from({ length: linhas }).map((_, i) => (
      <div key={i} className="esqueleto" style={{ height: 58 }} />
    ))}
  </div>
);

/** Barra de ocupação: quanto do evento já foi vendido. */
export function Ocupacao({ reservados, capacidade }: { reservados: number; capacidade: number }) {
  const pct = capacidade > 0 ? Math.min(100, Math.round((reservados / capacidade) * 100)) : 0;
  const esgotado = capacidade > 0 && reservados >= capacidade;
  return (
    <div>
      <div className="lin" style={{ justifyContent: "space-between", fontSize: ".76rem", marginBottom: 4 }}>
        <span className="ter">{reservados} de {capacidade} lugares</span>
        <span className={esgotado ? "ter" : ""} style={{ color: esgotado ? "var(--vermelho)" : undefined }}>
          {esgotado ? "Esgotado" : `${pct}%`}
        </span>
      </div>
      <div className={`barra ${esgotado ? "" : "verde"}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Campo de formulário com rótulo, ajuda e erro — o padrão das telas de criação. */
export function Campo(
  { id, rotulo, ajuda, erro, obrigatorio, children }:
  {
    id: string; rotulo: string; ajuda?: string; erro?: string | null;
    obrigatorio?: boolean; children: ReactNode;
  }
) {
  return (
    <div className="campo">
      <label htmlFor={id}>
        {rotulo}{obrigatorio && <span className="obrigatorio" aria-hidden="true"> *</span>}
      </label>
      {children}
      {erro ? <small className="ajuda" style={{ color: "var(--vermelho)" }}>{erro}</small>
            : ajuda && <small className="ajuda">{ajuda}</small>}
    </div>
  );
}
