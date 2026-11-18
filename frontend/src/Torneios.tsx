import { useState } from "react";
import { api } from "./api";
import { usePolling, useTorneios } from "./hooks";
import { Ctx, Formato, Inscricao, RodadaChave, Torneio } from "./types";
import { Alerta, Badge, ROTULO_FORMATO, Secao } from "./ui";

export function Torneios({ ctx }: { ctx: Ctx }) {
  const { torneios, erro: erroLista, recarregar } = useTorneios(3000);
  const [sel, setSel] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState({ nome: "", formato: "ELIMINACAO_SIMPLES" as Formato, maxEquipes: 4 });

  const acao = async (id: string, caminho: string) => {
    try { await api("POST", `torneios/${id}/${caminho}`); setErro(null); await recarregar(); }
    catch (e) { setErro((e as Error).message); }
  };
  const criar = async () => {
    try { await api("POST", "torneios", form); setForm({ ...form, nome: "" }); setErro(null); await recarregar(); }
    catch (e) { setErro((e as Error).message); }
  };

  return (
    <>
      <Alerta texto={erro ?? erroLista} />
      {ctx.eu.papel === "ORGANIZADOR" && (
        <Secao titulo="Criar torneio">
          <div className="linha">
            <input placeholder="Nome do torneio" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            <select value={form.formato} onChange={(e) => setForm({ ...form, formato: e.target.value as Formato })}>
              <option value="ELIMINACAO_SIMPLES">Eliminação simples</option>
              <option value="PONTOS_CORRIDOS">Pontos corridos</option>
            </select>
            <input type="number" min={2} max={32} style={{ width: 80 }} value={form.maxEquipes}
              onChange={(e) => setForm({ ...form, maxEquipes: Number(e.target.value) })} title="Máximo de equipes" />
            <button onClick={criar}>Criar</button>
          </div>
        </Secao>
      )}

      <div className="grade">
        {torneios.length === 0 && <p className="dica">Nenhum torneio criado ainda.</p>}
        {torneios.map((t) => {
          const dono = t.organizadorId === ctx.eu.id;
          return (
            <section key={t.id} className={`card ${sel === t.id ? "ativo" : ""}`}>
              <h3>{t.nome} <Badge status={t.status} /></h3>
              <p className="dica">{ROTULO_FORMATO[t.formato]} · até {t.maxEquipes} equipes · org.: {ctx.nomeUsuario(t.organizadorId)}</p>
              {t.campeaoId && <p className="campeao">🏆 Campeã: {ctx.nomeEquipe(t.campeaoId)}</p>}
              <div className="linha">
                <button className="mini" onClick={() => setSel(sel === t.id ? null : t.id)}>{sel === t.id ? "Fechar detalhes" : "Ver detalhes"}</button>
                {dono && t.status === "RASCUNHO" && <button className="mini" onClick={() => acao(t.id, "abrir")}>Abrir inscrições</button>}
                {dono && t.status === "INSCRICOES_ABERTAS" && <button className="mini" onClick={() => acao(t.id, "iniciar")}>Iniciar torneio</button>}
                {dono && ["RASCUNHO", "INSCRICOES_ABERTAS", "EM_ANDAMENTO"].includes(t.status) && (
                  <button className="mini perigo" onClick={() => acao(t.id, "cancelar")}>Cancelar</button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {sel && torneios.find((t) => t.id === sel) && <Detalhe ctx={ctx} torneio={torneios.find((t) => t.id === sel)!} />}
    </>
  );
}

function Detalhe({ ctx, torneio }: { ctx: Ctx; torneio: Torneio }) {
  const [insc, setInsc] = useState<Inscricao[]>([]);
  const [chave, setChave] = useState<RodadaChave[]>([]);
  const [equipeId, setEquipeId] = useState("");
  const [msg, setMsg] = useState<{ texto: string; tipo: "erro" | "info" } | null>(null);

  usePolling(async () => {
    try {
      const [i, c] = await Promise.all([
        api<Inscricao[]>("GET", `torneios/${torneio.id}/inscricoes`),
        api<RodadaChave[]>("GET", `torneios/${torneio.id}/chave`),
      ]);
      setInsc(i); setChave(c);
    } catch (e) { setMsg({ texto: (e as Error).message, tipo: "erro" }); }
  }, 3000, [torneio.id]);

  const minhasEquipes = ctx.equipes.filter((e) => e.capitaoId === ctx.eu.id);
  const inscrever = async () => {
    try {
      await api("POST", `torneios/${torneio.id}/inscricoes`, { equipeId });
      setMsg({ texto: "Inscrição solicitada. A validação acontece de forma assíncrona (veja o status abaixo).", tipo: "info" });
    } catch (e) { setMsg({ texto: (e as Error).message, tipo: "erro" }); }
  };

  return (
    <Secao titulo={`Detalhes · ${torneio.nome}`}>
      <Alerta texto={msg?.texto ?? null} tipo={msg?.tipo} />
      {ctx.eu.papel === "JOGADOR" && torneio.status === "INSCRICOES_ABERTAS" && (
        minhasEquipes.length === 0
          ? <p className="dica">Somente capitães podem inscrever uma equipe. Crie uma equipe na aba Equipes.</p>
          : (
            <div className="linha">
              <select value={equipeId} onChange={(e) => setEquipeId(e.target.value)}>
                <option value="">Escolha sua equipe…</option>
                {minhasEquipes.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
              <button disabled={!equipeId} onClick={inscrever}>Inscrever equipe</button>
            </div>
          )
      )}

      <h4>Inscrições</h4>
      {insc.length === 0 ? <p className="dica">Nenhuma inscrição.</p> : (
        <table>
          <thead><tr><th>Equipe</th><th>Status</th><th>Motivo</th></tr></thead>
          <tbody>
            {insc.map((i) => (
              <tr key={i.id}><td>{i.nomeEquipe ?? ctx.nomeEquipe(i.equipeId)}</td><td><Badge status={i.status} /></td><td>{i.motivo ?? ""}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Chave</h4>
      {chave.length === 0 ? <p className="dica">A chave aparece quando o torneio é iniciado.</p> : chave.map((r) => (
        <div key={r.rodada} className="rodada">
          <strong>Rodada {r.rodada}</strong>
          {r.partidas.map((p) => (
            <div key={p.partidaId} className="partida-linha">
              {p.bye
                ? <span>{ctx.nomeEquipe(p.equipeA)} avança direto (bye)</span>
                : <span className={p.vencedorId ? "" : "dica"}>
                    {ctx.nomeEquipe(p.equipeA)} <b>{p.placarA ?? "–"}</b> x <b>{p.placarB ?? "–"}</b> {ctx.nomeEquipe(p.equipeB)}
                  </span>}
              {!p.bye && <Badge status={p.status} />}
            </div>
          ))}
        </div>
      ))}
    </Secao>
  );
}
