import { useMemo, useState } from "react";
import { Bell, CheckCheck, Flag, Swords, Trophy, UserPlus } from "lucide-react";
import { LucideIcon } from "lucide-react";
import { api } from "../api";
import { usePolling, useTorneios } from "../hooks";
import { Notificacao } from "../types";
import { Alerta, PaginaTopo, Vazio, desde } from "../components/ui";

const ESTILO: Record<string, { icone: LucideIcon; cor: string; rotulo: string }> = {
  USUARIO_REGISTRADO: { icone: UserPlus, cor: "azul", rotulo: "Nova conta" },
  RESULTADO_INFORMADO: { icone: Swords, cor: "azul", rotulo: "Resultado informado" },
  RESULTADO_CONFIRMADO: { icone: CheckCheck, cor: "verde", rotulo: "Resultado confirmado" },
  RESULTADO_CONTESTADO: { icone: Flag, cor: "vermelho", rotulo: "Contestação" },
  TORNEIO_FINALIZADO: { icone: Trophy, cor: "ambar", rotulo: "Torneio finalizado" },
};

/** Marcação de leitura é preferência de exibição, guardada só neste navegador. */
export const CHAVE_LIDAS = "arenahub.avisosLidos";
export const lerLidas = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(CHAVE_LIDAS) ?? "[]") as string[]); }
  catch { return new Set(); }
};
const gravarLidas = (ids: Set<string>) => {
  try { localStorage.setItem(CHAVE_LIDAS, JSON.stringify([...ids].slice(-400))); } catch { /* ignora */ }
};

export function Avisos({ aoMudarLidas }: { aoMudarLidas: () => void }) {
  const { torneios } = useTorneios();
  const [origem, setOrigem] = useState("todos");
  const [aba, setAba] = useState<"naoLidas" | "todas">("naoLidas");
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [lidas, setLidas] = useState<Set<string>>(lerLidas);
  const [erro, setErro] = useState<string | null>(null);

  usePolling(async () => {
    const caminho = origem === "minhas" ? "notificacoes/minhas?limite=50"
      : origem === "todos" ? "notificacoes?limite=50" : `notificacoes?torneioId=${origem}&limite=50`;
    try { setItens(await api<Notificacao[]>("GET", caminho)); setErro(null); }
    catch (e) { setErro(`${(e as Error).message}. As outras páginas continuam funcionando normalmente.`); }
  }, 4000, [origem]);

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
        descricao="Tudo o que aconteceu nos torneios, nas partidas e nas contas, do mais recente para o mais antigo."
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
        <select value={origem} onChange={(e) => setOrigem(e.target.value)} style={{ maxWidth: 230 }} aria-label="Origem dos avisos">
          <option value="todos">Toda a plataforma</option>
          <option value="minhas">Só o que é meu</option>
          {torneios.map((t) => <option key={t.id} value={t.id}>Torneio {t.nome}</option>)}
        </select>
      </div>

      <Alerta texto={erro} />

      {visiveis.length === 0 ? (
        <Vazio icone={Bell}
          titulo={aba === "naoLidas" && itens.length > 0 ? "Você está em dia" : "Nenhum aviso ainda"}
          texto={aba === "naoLidas" && itens.length > 0
            ? "Não há avisos novos nesta seleção."
            : "Os avisos chegam quando contas são criadas, resultados são registrados e torneios terminam."} />
      ) : (
        <div className="tabela-caixa">
          {visiveis.map((n) => {
            const e = ESTILO[n.tipo] ?? { icone: Bell, cor: "azul", rotulo: "Aviso" };
            const nova = !lidas.has(n.id);
            return (
              <div key={n.id} className={`aviso ${nova ? "nova" : ""}`}>
                <span className={`icone ${e.cor === "azul" ? "" : ""}`}
                  style={{ background: `var(--${e.cor === "ambar" ? "ambar" : e.cor}-fraco)`, color: `var(--${e.cor === "ambar" ? "ambar" : e.cor})` }}>
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
