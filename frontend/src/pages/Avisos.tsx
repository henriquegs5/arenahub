import { useMemo, useState } from "react";
import {
  Bell, CalendarClock, CheckCheck, LucideIcon, Ticket, Trash2,
  UserCog, UserPlus, Undo2, XCircle, Undo,
} from "lucide-react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { Notificacao } from "../types";
import { Alerta, Confirmacao, PaginaTopo, Vazio, Girando, desde } from "../components/ui";

/**
 * O rótulo descreve a CATEGORIA do aviso e nunca repete o título da mensagem.
 * Ex.: título "Ingresso emitido" + rótulo "Compra" — não "Ingresso emitido" duas vezes.
 */
const ESTILO: Record<string, { icone: LucideIcon; cor: string; rotulo: string }> = {
  USUARIO_REGISTRADO: { icone: UserPlus, cor: "verde", rotulo: "Conta" },
  USUARIO_ATUALIZADO: { icone: UserCog, cor: "azul", rotulo: "Conta" },
  INGRESSO_EMITIDO: { icone: Ticket, cor: "verde", rotulo: "Compra" },
  PAGAMENTO_RECUSADO: { icone: XCircle, cor: "vermelho", rotulo: "Pagamento" },
  PEDIDO_CANCELADO: { icone: Undo2, cor: "ambar", rotulo: "Pedido" },
  ESTORNO_CONCLUIDO: { icone: Undo, cor: "azul", rotulo: "Reembolso" },
  EVENTO_ALTERADO: { icone: CalendarClock, cor: "ambar", rotulo: "Mudança no evento" },
};

const estiloDe = (tipo: string) => ESTILO[tipo] ?? { icone: Bell, cor: "azul", rotulo: "Aviso" };

export function Avisos({ aoMudarLidas }: { aoMudarLidas: () => void }) {
  const [aba, setAba] = useState<"naoLidas" | "todas">("naoLidas");
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState<"limpar" | null>(null);

  const recarregar = async () => {
    try {
      setItens(await api<Notificacao[]>("GET", "notificacoes/minhas?limite=50"));
      setErro(null);
    } catch (e) {
      setErro(`${(e as Error).message}. As outras páginas continuam funcionando normalmente.`);
    }
  };

  usePolling(recarregar, 4000, []);

  /** Toda ação vai ao backend e recarrega: a verdade está no servidor. */
  const agir = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await fn();
      await recarregar();
      aoMudarLidas();
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const marcarLida = (n: Notificacao) =>
    agir(() => api("POST", `notificacoes/${n.id}/${n.lida ? "nao-lida" : "lida"}`));

  const marcarTodas = () => agir(() => api("POST", "notificacoes/lidas"));
  const excluir = (id: string) => agir(() => api("DELETE", `notificacoes/${id}`));

  const limparLidas = () =>
    agir(async () => {
      await api("DELETE", "notificacoes/lidas");
      setConfirmando(null);
    });

  const naoLidas = useMemo(() => itens.filter((n) => !n.lida), [itens]);
  const lidas = useMemo(() => itens.filter((n) => n.lida), [itens]);
  const visiveis = aba === "naoLidas" ? naoLidas : itens;

  return (
    <>
      <PaginaTopo
        titulo="Notificações"
        descricao="Seus avisos, do mais recente para o mais antigo."
        acoes={
          <>
            {naoLidas.length > 0 && (
              <button className="b-secundario" onClick={marcarTodas} disabled={ocupado}>
                {ocupado ? <Girando /> : <CheckCheck size={16} />}Marcar todas como lidas
              </button>
            )}
            {lidas.length > 0 && (
              <button className="b-fantasma" onClick={() => setConfirmando("limpar")} disabled={ocupado}>
                <Trash2 size={16} />Limpar lidas
              </button>
            )}
          </>
        }
      />

      <div className="filtros">
        <button className={`aba-filtro ${aba === "naoLidas" ? "ativo" : ""}`} onClick={() => setAba("naoLidas")}>
          Não lidas<span className="n">{naoLidas.length}</span>
        </button>
        <button className={`aba-filtro ${aba === "todas" ? "ativo" : ""}`} onClick={() => setAba("todas")}>
          Todas<span className="n">{itens.length}</span>
        </button>
      </div>

      <Alerta texto={erro} />

      {visiveis.length === 0 ? (
        <Vazio
          icone={Bell}
          titulo={aba === "naoLidas" && itens.length > 0 ? "Você está em dia" : "Nenhum aviso ainda"}
          texto={
            aba === "naoLidas" && itens.length > 0
              ? "Não há avisos novos."
              : "Os avisos chegam a cada compra, emissão de ingresso, pagamento recusado ou mudança num evento do qual você tem ingresso."
          }
        />
      ) : (
        <div className="tabela-caixa">
          {visiveis.map((n) => {
            const e = estiloDe(n.tipo);
            return (
              <div key={n.id} className={`aviso ${n.lida ? "" : "nova"}`}>
                <span
                  className="icone"
                  style={{ background: `var(--${e.cor}-fraco)`, color: `var(--${e.cor})` }}
                >
                  <e.icone size={16} />
                </span>
                <div className="corpo">
                  <div className="lin" style={{ gap: 8 }}>
                    <b>{n.titulo}</b>
                    <span className="ter">{e.rotulo}</span>
                  </div>
                  <p>{n.mensagem}</p>
                </div>
                <div className="col" style={{ alignItems: "flex-end", gap: 6 }}>
                  <span className="tempo">{desde(n.criadoEm)}</span>
                  <div className="lin" style={{ gap: 4 }}>
                    <button
                      className="b-fantasma b-pequeno"
                      onClick={() => marcarLida(n)}
                      disabled={ocupado}
                      title={n.lida ? "Marcar como não lida" : "Marcar como lida"}
                    >
                      {n.lida ? "Não lida" : "Marcar lido"}
                    </button>
                    <button
                      className="b-fantasma b-pequeno b-icone"
                      onClick={() => excluir(n.id)}
                      disabled={ocupado}
                      aria-label={`Excluir aviso: ${n.titulo}`}
                      title="Excluir"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmando === "limpar" && (
        <Confirmacao
          titulo="Limpar avisos lidos"
          texto={`Isto exclui ${lidas.length} aviso(s) já lido(s). Os não lidos continuam aqui.`}
          rotuloConfirmar="Excluir lidos"
          perigo
          aoConfirmar={limparLidas}
          aoCancelar={() => setConfirmando(null)}
        />
      )}
    </>
  );
}
