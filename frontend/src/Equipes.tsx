import { useState } from "react";
import { api } from "./api";
import { Ctx } from "./types";
import { Alerta, Secao } from "./ui";

export function Equipes({ ctx }: { ctx: Ctx }) {
  const [nome, setNome] = useState("");
  const [novo, setNovo] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  const executar = async (fn: () => Promise<unknown>) => {
    try { await fn(); setErro(null); await ctx.recarregar(); }
    catch (e) { setErro((e as Error).message); }
  };

  const emEquipe = new Set(ctx.equipes.flatMap((e) => e.membros));
  const livres = ctx.usuarios.filter((u) => u.papel === "JOGADOR" && !emEquipe.has(u.id));
  const jaTenhoEquipe = emEquipe.has(ctx.eu.id);

  return (
    <>
      <Alerta texto={erro} />
      {ctx.eu.papel === "JOGADOR" && !jaTenhoEquipe && (
        <Secao titulo="Criar equipe (você será o capitão)">
          <div className="linha">
            <input placeholder="Nome da equipe" value={nome} onChange={(e) => setNome(e.target.value)} />
            <button onClick={() => executar(async () => { await api("POST", "equipes", { nome }); setNome(""); })}>Criar</button>
          </div>
        </Secao>
      )}
      {ctx.eu.papel === "JOGADOR" && jaTenhoEquipe && <p className="dica">Você já participa de uma equipe.</p>}

      <div className="grade">
        {ctx.equipes.length === 0 && <p className="dica">Nenhuma equipe criada ainda.</p>}
        {ctx.equipes.map((e) => {
          const souCapitao = e.capitaoId === ctx.eu.id;
          return (
            <section key={e.id} className="card">
              <h3>{e.nome}</h3>
              <p className="dica">Capitão: {ctx.nomeUsuario(e.capitaoId)} · {e.membros.length} membro(s)</p>
              <ul>
                {e.membros.map((m) => (
                  <li key={m}>
                    {ctx.nomeUsuario(m)}{m === e.capitaoId ? " 👑" : ""}
                    {souCapitao && m !== e.capitaoId && (
                      <button className="mini perigo" onClick={() => executar(() => api("DELETE", `equipes/${e.id}/membros/${m}`))}>remover</button>
                    )}
                  </li>
                ))}
              </ul>
              {souCapitao && (
                <div className="linha">
                  <select value={novo[e.id] ?? ""} onChange={(ev) => setNovo({ ...novo, [e.id]: ev.target.value })}>
                    <option value="">Adicionar jogador…</option>
                    {livres.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                  <button
                    disabled={!novo[e.id]}
                    onClick={() => executar(async () => { await api("POST", `equipes/${e.id}/membros`, { usuarioId: novo[e.id] }); setNovo({ ...novo, [e.id]: "" }); })}
                  >Adicionar</button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
