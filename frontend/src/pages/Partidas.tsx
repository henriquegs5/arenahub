import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Swords } from "lucide-react";
import { api } from "../api";
import { usePolling, useTorneios } from "../hooks";
import { Ctx, Partida } from "../types";
import { Alerta, Escudo, Girando, PaginaTopo, Selo, Stat, Vazio, hora } from "../components/ui";

const FILTROS = [
  { id: "todas", nome: "Todas" },
  { id: "AGENDADA", nome: "A disputar" },
  { id: "RESULTADO_INFORMADO", nome: "Aguardando confirmação" },
  { id: "CONTESTADA", nome: "Contestadas" },
  { id: "CONFIRMADA", nome: "Concluídas" },
];

export function Partidas({ ctx }: { ctx: Ctx }) {
  const { torneios } = useTorneios();
  const [torneioId, setTorneioId] = useState("todos");
  const [filtro, setFiltro] = useState("todas");
  const [lista, setLista] = useState<Partida[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregou, setCarregou] = useState(false);

  const carregar = async () => {
    try {
      setLista(await api<Partida[]>("GET", torneioId === "todos" ? "partidas" : `partidas?torneioId=${torneioId}`));
      setErro(null);
    } catch (e) { setErro((e as Error).message); }
    finally { setCarregou(true); }
  };
  useEffect(() => { setCarregou(false); }, [torneioId]);
  usePolling(carregar, 3000, [torneioId]);

  const conta = (id: string) => id === "todas" ? lista.length : lista.filter((p) => p.status === id).length;
  const visiveis = useMemo(() => lista.filter((p) => filtro === "todas" || p.status === filtro), [lista, filtro]);

  return (
    <>
      <PaginaTopo titulo="Partidas" descricao="Informe placares, confirme resultados e acompanhe cada confronto da chave." />

      <div className="grade g-stats mb">
        <Stat icone={Swords} cor="azul" valor={lista.length} rotulo="Confrontos gerados" />
        <Stat icone={Swords} cor="ambar" valor={conta("AGENDADA")} rotulo="A disputar" />
        <Stat icone={Swords} cor="vermelho" valor={conta("RESULTADO_INFORMADO") + conta("CONTESTADA")} rotulo="Precisam de decisão" />
        <Stat icone={Swords} cor="verde" valor={conta("CONFIRMADA")} rotulo="Concluídas" />
      </div>

      <div className="filtros">
        <select value={torneioId} onChange={(e) => setTorneioId(e.target.value)} style={{ maxWidth: 240 }} aria-label="Torneio">
          <option value="todos">Todos os torneios</option>
          {torneios.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
        {FILTROS.map((f) => (
          <button key={f.id} className={`aba-filtro ${filtro === f.id ? "ativo" : ""}`} onClick={() => setFiltro(f.id)}>
            {f.nome}<span className="n">{conta(f.id)}</span>
          </button>
        ))}
      </div>

      <Alerta texto={erro} />

      {!carregou && lista.length === 0 && (
        <div className="grade g-cartoes">
          {[0, 1, 2].map((i) => <div key={i} className="cartao"><div className="esqueleto" style={{ height: 92 }} /></div>)}
        </div>
      )}

      {carregou && visiveis.length === 0 && (
        <Vazio icone={Swords}
          titulo={lista.length === 0 ? "Nenhum confronto ainda" : "Nada neste filtro"}
          texto={lista.length === 0
            ? "Os confrontos são gerados automaticamente quando o organizador inicia um torneio com pelo menos duas equipes confirmadas."
            : "Troque o filtro ou escolha outro torneio."} />
      )}

      {visiveis.length > 0 && (
        <div className="grade g-cartoes">
          {visiveis.map((p) => <CartaoPartida key={p.id} p={p} ctx={ctx} aoMudar={carregar} />)}
        </div>
      )}
    </>
  );
}

function CartaoPartida({ p, ctx, aoMudar }: { p: Partida; ctx: Ctx; aoMudar: () => Promise<void> }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [hist, setHist] = useState<Partida | null>(null);

  const executar = async (caminho: string, corpo?: unknown) => {
    setOcupado(true);
    try {
      await api("POST", `partidas/${p.id}/${caminho}`, corpo);
      setErro(null); setA(""); setB(""); setMotivo("");
      await aoMudar();
      if (hist) await verHistorico();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  };
  const verHistorico = async () => {
    try { setHist(await api<Partida>("GET", `partidas/${p.id}`)); } catch (e) { setErro((e as Error).message); }
  };

  const souCapitao = ctx.eu.id === p.capitaoAId || ctx.eu.id === p.capitaoBId;
  const souOrg = ctx.eu.id === p.organizadorId;
  const concluida = p.status === "CONFIRMADA";
  const venceuA = concluida && (p.placarA ?? 0) > (p.placarB ?? 0);
  const venceuB = concluida && (p.placarB ?? 0) > (p.placarA ?? 0);
  const placarOk = a !== "" && b !== "";
  const placar = { placarA: Number(a), placarB: Number(b) };

  const entradaPlacar = (rotulo: string) => (
    <div className="lin mt">
      <span className="ter" style={{ width: "100%" }}>{rotulo}</span>
      <input type="number" min={0} style={{ width: 76 }} value={a} onChange={(e) => setA(e.target.value)} aria-label={`Placar de ${ctx.nomeEquipe(p.equipeAId)}`} />
      <span className="ter">x</span>
      <input type="number" min={0} style={{ width: 76 }} value={b} onChange={(e) => setB(e.target.value)} aria-label={`Placar de ${ctx.nomeEquipe(p.equipeBId)}`} />
    </div>
  );

  return (
    <section className="cartao">
      <div className="cartao-cab">
        <span className="ter" style={{ flex: 1 }}>{ctx.nomeTorneio(p.torneioId)} · rodada {p.rodada}</span>
        <Selo status={p.status} />
      </div>

      <div className="confronto">
        <div className={`lado ${venceuA ? "vencedor" : venceuB ? "perdedor" : ""}`}>
          <Escudo nome={ctx.nomeEquipe(p.equipeAId)} />
          <span className="nome">{ctx.nomeEquipe(p.equipeAId)}</span>
        </div>
        <div className="placar">
          <span className={p.placarA === null ? "vazio" : ""}>{p.placarA ?? "–"}</span>
          <span className="x">x</span>
          <span className={p.placarB === null ? "vazio" : ""}>{p.placarB ?? "–"}</span>
        </div>
        <div className={`lado ${venceuB ? "vencedor" : venceuA ? "perdedor" : ""}`}>
          <Escudo nome={ctx.nomeEquipe(p.equipeBId)} />
          <span className="nome">{ctx.nomeEquipe(p.equipeBId)}</span>
        </div>
      </div>

      {p.status === "CONTESTADA" && (
        <p className="sec">{ctx.nomeUsuario(p.contestadoPor)} contestou: “{p.motivoContestacao}”</p>
      )}
      {p.status === "RESULTADO_INFORMADO" && (
        <p className="sec">Informado por {ctx.nomeUsuario(p.informadoPor)}. Falta a confirmação do organizador.</p>
      )}
      {p.status === "AGENDADA" && !souCapitao && (
        <p className="sec">O capitão de uma das equipes informa o placar quando a partida terminar.</p>
      )}

      <Alerta texto={erro} />

      {p.status === "AGENDADA" && souCapitao && (
        <>
          {entradaPlacar("Informe o placar final")}
          <button className="b-primario b-pequeno mt" disabled={!placarOk || ocupado} onClick={() => executar("resultado", placar)}>
            {ocupado && <Girando />}Informar resultado
          </button>
        </>
      )}
      {p.status === "RESULTADO_INFORMADO" && souOrg && (
        <button className="b-primario b-pequeno mt" disabled={ocupado} onClick={() => executar("confirmar")}>
          {ocupado && <Girando />}Confirmar resultado
        </button>
      )}
      {p.status === "RESULTADO_INFORMADO" && souCapitao && ctx.eu.id !== p.informadoPor && (
        <div className="lin mt">
          <input placeholder="Por que o placar está errado?" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ flex: 1, minWidth: 150 }} />
          <button className="b-perigo b-pequeno" disabled={motivo.trim().length < 3 || ocupado} onClick={() => executar("contestar", { motivo })}>
            Contestar
          </button>
        </div>
      )}
      {p.status === "CONTESTADA" && souOrg && (
        <>
          {entradaPlacar("Defina o placar correto")}
          <button className="b-primario b-pequeno mt" disabled={!placarOk || ocupado} onClick={() => executar("resolver", placar)}>
            {ocupado && <Girando />}Resolver e encerrar
          </button>
        </>
      )}

      <button className="b-fantasma b-pequeno mt" onClick={() => (hist ? setHist(null) : verHistorico())}>
        <ChevronDown size={14} style={{ transform: hist ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
        Histórico da partida
      </button>
      {hist?.historico && (
        <div className="lista">
          {hist.historico.length === 0 && <p className="ter">Nenhuma ação registrada ainda.</p>}
          {hist.historico.map((h, i) => (
            <div key={i} className="lista-item">
              <div className="cresce">
                <div className="meta">{ROTULO_COMANDO[h.comando] ?? h.comando} — {ctx.nomeUsuario(h.usuarioId)}</div>
              </div>
              <span className="tempo">{hora(h.executadoEm)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const ROTULO_COMANDO: Record<string, string> = {
  INFORMAR_RESULTADO: "Resultado informado",
  CONFIRMAR_RESULTADO: "Resultado confirmado",
  CONTESTAR_RESULTADO: "Resultado contestado",
  RESOLVER_CONTESTACAO: "Contestação resolvida",
};
