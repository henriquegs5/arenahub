import { useMemo, useState } from "react";
import { Bell, CheckCheck, LucideIcon, UserCog, UserPlus } from "lucide-react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { Notificacao } from "../types";
import { Alerta, PaginaTopo, Vazio, desde } from "../components/ui";

/**
 * O rótulo descreve a CATEGORIA do aviso e nunca repete o título da mensagem.
 * Avisos de compra, pagamento, emissão e cancelamento entram no lote 4.
 */
const ESTILO: Record<string, { icone: LucideIcon; cor: string; rotulo: string }> = {
  USUARIO_REGISTRADO: { icone: UserPlus, cor: "verde", rotulo: "Conta" },
  USUARIO_ATUALIZADO: { icone: UserCog, cor: "azul", rotulo: "Conta" },
};

/**
 * LIMITAÇÃO CONHECIDA (resolvida no lote 4): a marcação de leitura ainda é
 * guardada só neste navegador. Ela passa para o backend junto com o CRUD
 * completo de notificações — marcar como lida, marcar todas, excluir e contador.
 */
export const CHAVE_LIDAS = "arenahub.avisosLidos";

export const lerLidas = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_LIDAS) ?? "[]") as string[]); }
  catch { return new Set(); }
};

const gravarLidas = (ids: Set<string>) => {
  try { localStorage.setItem(CHAVE_LIDAS, JSON.stringify([...ids].slice(-400))); } catch { /* ignora */ }
};

export function Avisos({ aoMudarLidas }: { aoMudarLidas: () => void }) {
  const [aba, setAba] = useState<"naoLidas" | "todas">("naoLidas");
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [lidas, setLidas] = useState<Set<string>>(lerLidas);
  const [erro, setErro] = useState<string | null>(null);

  usePolling(async () => {
    try {
      setItens(await api<Notificacao[]>("GET", "notificacoes/minhas?limite=50"));
      setErro(null);
    } catch (e) {
      setErro(`${(e as Error).message}. As outras páginas continuam funcionando normalmente.`);
    }
  }, 4000, []);

  const marcar = (ids: string[]) => {
    const novo = new Set(lidas);
    ids.forEach((i) => novo.add(i));
    setLidas(novo); gravarLidas(novo); aoMudarLidas();
  };

  const naoLidas = useMemo(() => itens.filter((n) => !lidas.has(n.id)), [itens, lidas]);
  const visiveis = aba === "naoLidas" ? naoLidas : itens;

  return (
    <>
      <PaginaTopo
        titulo="Notificações"
        descricao="Seus avisos, do mais recente para o mais antigo."
        acoes={naoLidas.length > 0
          ? <button className="b-secundario" onClick={() => marcar(itens.map((n) => n.id))}><CheckCheck size={16} />Marcar tudo como lido</button>
          : undefined}
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
        <Vazio icone={Bell}
          titulo={aba === "naoLidas" && itens.length > 0 ? "Você está em dia" : "Nenhum aviso ainda"}
          texto={aba === "naoLidas" && itens.length > 0
            ? "Não há avisos novos."
            : "Os avisos chegam quando sua conta muda e, em breve, a cada compra, emissão de ingresso ou alteração de evento."} />
      ) : (
        <div className="tabela-caixa">
          {visiveis.map((n) => {
            const e = ESTILO[n.tipo] ?? { icone: Bell, cor: "azul", rotulo: "Aviso" };
            const nova = !lidas.has(n.id);
            return (
              <div key={n.id} className={`aviso ${nova ? "nova" : ""}`}>
                <span className="icone" style={{ background: `var(--${e.cor}-fraco)`, color: `var(--${e.cor})` }}>
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
                  {nova && <button className="b-fantasma b-pequeno" onClick={() => marcar([n.id])}>Marcar lido</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
