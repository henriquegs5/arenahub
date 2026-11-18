import { useEffect, useState } from "react";
import { api } from "./api";
import { usePolling, useTorneios } from "./hooks";
import { Ctx, Partida } from "./types";
import { Alerta, Badge, hora } from "./ui";

export function Partidas({ ctx }: { ctx: Ctx }) {
  const { torneios } = useTorneios();
  const [sel, setSel] = useState("");
  const [lista, setLista] = useState<Partida[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { if (!sel && torneios.length > 0) setSel(torneios[0].id); }, [torneios, sel]);

  const carregar = async () => {
    if (!sel) return;
    try { setLista(await api<Partida[]>("GET", `partidas?torneioId=${sel}`)); setErro(null); }
    catch (e) { setErro((e as Error).message); }
  };
  usePolling(carregar, 3000, [sel]);

  return (
    <>
      <div className="linha">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {torneios.length === 0 && <option value="">Nenhum torneio</option>}
          {torneios.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </div>
      <Alerta texto={erro} />
      {lista.length === 0 && <p className="dica">Sem partidas neste torneio (elas surgem quando o torneio é iniciado).</p>}
      <div className="grade">
        {lista.map((p) => <CartaoPartida key={p.id} p={p} ctx={ctx} aoMudar={carregar} />)}
      </div>
    </>
  );
}

function CartaoPartida({ p, ctx, aoMudar }: { p: Partida; ctx: Ctx; aoMudar: () => Promise<void> }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [hist, setHist] = useState<Partida | null>(null);

  const executar = async (caminho: string, corpo?: unknown) => {
    try { await api("POST", `partidas/${p.id}/${caminho}`, corpo); setErro(null); setA(""); setB(""); setMotivo(""); await aoMudar(); if (hist) await verHistorico(); }
    catch (e) { setErro((e as Error).message); }
  };
  const verHistorico = async () => {
    try { setHist(await api<Partida>("GET", `partidas/${p.id}`)); } catch (e) { setErro((e as Error).message); }
  };

  const souCapitao = ctx.eu.id === p.capitaoAId || ctx.eu.id === p.capitaoBId;
  const souOrg = ctx.eu.id === p.organizadorId;
  const placar = { placarA: Number(a), placarB: Number(b) };
  const placarOk = a !== "" && b !== "";

  const inputs = (
    <div className="linha">
      <input type="number" min={0} style={{ width: 70 }} placeholder="placar A" value={a} onChange={(e) => setA(e.target.value)} />
      <span>x</span>
      <input type="number" min={0} style={{ width: 70 }} placeholder="placar B" value={b} onChange={(e) => setB(e.target.value)} />
    </div>
  );

  return (
    <section className="card">
      <h3>{ctx.nomeEquipe(p.equipeAId)} <span className="vs">x</span> {ctx.nomeEquipe(p.equipeBId)}</h3>
      <p className="dica">Rodada {p.rodada}</p>
      <p>
        <Badge status={p.status} />{" "}
        {p.placarA !== null && <b>{p.placarA} x {p.placarB}</b>}
      </p>
      {p.status === "CONTESTADA" && <p className="dica">Contestada por {ctx.nomeUsuario(p.contestadoPor)}: “{p.motivoContestacao}”</p>}
      <Alerta texto={erro} />

      {p.status === "AGENDADA" && souCapitao && (
        <>{inputs}<button disabled={!placarOk} onClick={() => executar("resultado", placar)}>Informar resultado</button></>
      )}
      {p.status === "RESULTADO_INFORMADO" && souOrg && (
        <button onClick={() => executar("confirmar")}>Confirmar resultado</button>
      )}
      {p.status === "RESULTADO_INFORMADO" && souCapitao && ctx.eu.id !== p.informadoPor && (
        <div className="linha">
          <input placeholder="Motivo da contestação" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button className="perigo" disabled={motivo.trim().length < 3} onClick={() => executar("contestar", { motivo })}>Contestar</button>
        </div>
      )}
      {p.status === "CONTESTADA" && souOrg && (
        <>{inputs}<button disabled={!placarOk} onClick={() => executar("resolver", placar)}>Resolver contestação</button></>
      )}

      <button className="link" onClick={() => (hist ? setHist(null) : verHistorico())}>{hist ? "Ocultar histórico" : "Ver histórico"}</button>
      {hist?.historico && (
        <ul className="historico">
          {hist.historico.length === 0 && <li className="dica">Sem ações ainda.</li>}
          {hist.historico.map((h, i) => (
            <li key={i}>{hora(h.executadoEm)} · {h.comando} por {ctx.nomeUsuario(h.usuarioId)} → {h.statusApos}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
