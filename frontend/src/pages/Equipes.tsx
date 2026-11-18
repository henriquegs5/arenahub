import { useMemo, useState } from "react";
import { Crown, Plus, Search, Shield, UserMinus, Users } from "lucide-react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { Ctx, Equipe, LinhaRanking } from "../types";
import { Alerta, Confirmacao, Escudo, Girando, PaginaTopo, Stat, Vazio } from "../components/ui";

export function Equipes({ ctx }: { ctx: Ctx }) {
  const [nome, setNome] = useState("");
  const [busca, setBusca] = useState("");
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [remover, setRemover] = useState<{ equipe: Equipe; usuarioId: string } | null>(null);
  const [ranking, setRanking] = useState<LinhaRanking[]>([]);

  // Estatísticas reais de desempenho vêm do serviço de Ranking.
  usePolling(async () => {
    try { setRanking(await api<LinhaRanking[]>("GET", "ranking/geral")); } catch { setRanking([]); }
  }, 6000, []);

  const executar = async (fn: () => Promise<unknown>) => {
    try { await fn(); setErro(null); await ctx.recarregar(); }
    catch (e) { setErro((e as Error).message); }
  };
  const criar = async () => {
    setSalvando(true);
    await executar(async () => { await api("POST", "equipes", { nome: nome.trim() }); setNome(""); setCriando(false); });
    setSalvando(false);
  };

  const emEquipe = new Set(ctx.equipes.flatMap((e) => e.membros));
  const jaTenhoEquipe = emEquipe.has(ctx.eu.id);
  const visiveis = useMemo(
    () => ctx.equipes.filter((e) => e.nome.toLowerCase().includes(busca.trim().toLowerCase())),
    [ctx.equipes, busca]
  );

  return (
    <>
      <PaginaTopo
        titulo="Equipes"
        descricao="Monte seu elenco, defina quem joga e acompanhe o desempenho da equipe nos campeonatos."
        acoes={ctx.eu.papel === "JOGADOR" && !jaTenhoEquipe
          ? <button className="b-primario" onClick={() => setCriando(!criando)}><Plus size={16} />Criar equipe</button>
          : undefined}
      />

      <div className="grade g-stats mb">
        <Stat icone={Shield} cor="azul" valor={ctx.equipes.length} rotulo="Equipes cadastradas" />
        <Stat icone={Users} cor="verde" valor={emEquipe.size} rotulo="Jogadores em equipes" />
        <Stat icone={Crown} cor="ambar" valor={ranking.reduce((s, l) => s + l.titulos, 0)} rotulo="Títulos conquistados" />
      </div>

      {criando && (
        <form className="cartao mb" onSubmit={(e) => { e.preventDefault(); criar(); }}>
          <h3 className="mb">Nova equipe</h3>
          <div className="campo" style={{ maxWidth: 360 }}>
            <label htmlFor="e-nome">Nome da equipe <span className="obrigatorio">*</span></label>
            <input id="e-nome" placeholder="Dragões do Norte" value={nome} onChange={(e) => setNome(e.target.value)} />
            <span className="ajuda">Você entra como capitão e pode adicionar mais jogadores depois.</span>
          </div>
          <div className="lin lin-fim mt">
            <button type="button" className="b-secundario" onClick={() => setCriando(false)}>Descartar</button>
            <button type="submit" className="b-primario" disabled={salvando || nome.trim().length < 2}>{salvando && <Girando />}Criar equipe</button>
          </div>
        </form>
      )}

      <Alerta texto={erro} />
      {ctx.eu.papel === "JOGADOR" && jaTenhoEquipe && !criando && (
        <Alerta tipo="info" texto="Você já faz parte de uma equipe. Cada jogador participa de uma equipe por vez." />
      )}

      {ctx.equipes.length > 0 && (
        <div className="filtros">
          <div className="busca">
            <Search size={15} />
            <input placeholder="Buscar equipe" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar equipe" />
          </div>
        </div>
      )}

      {visiveis.length === 0 ? (
        <Vazio icone={Shield}
          titulo={ctx.equipes.length === 0 ? "Nenhuma equipe ainda" : "Nenhuma equipe encontrada"}
          texto={ctx.equipes.length === 0
            ? "A primeira equipe criada vira o ponto de partida para as inscrições nos torneios."
            : "Tente outro termo na busca."} />
      ) : (
        <div className="grade g-cartoes">
          {visiveis.map((e) => (
            <CartaoEquipe key={e.id} e={e} ctx={ctx} livres={ctx.usuarios.filter((u) => u.papel === "JOGADOR" && !emEquipe.has(u.id))}
              linha={ranking.find((l) => l.equipeId === e.id)}
              aoExecutar={executar} aoRemover={(usuarioId) => setRemover({ equipe: e, usuarioId })} />
          ))}
        </div>
      )}

      {remover && (
        <Confirmacao
          titulo={`Remover ${ctx.nomeUsuario(remover.usuarioId)}?`}
          texto={`O jogador sai de ${remover.equipe.nome} e fica livre para entrar em outra equipe.`}
          rotuloConfirmar="Remover jogador" perigo
          aoCancelar={() => setRemover(null)}
          aoConfirmar={() => {
            const r = remover; setRemover(null);
            executar(() => api("DELETE", `equipes/${r.equipe.id}/membros/${r.usuarioId}`));
          }}
        />
      )}
    </>
  );
}

function CartaoEquipe(
  { e, ctx, livres, linha, aoExecutar, aoRemover }:
  { e: Equipe; ctx: Ctx; livres: Ctx["usuarios"]; linha?: LinhaRanking;
    aoExecutar: (fn: () => Promise<unknown>) => Promise<void>; aoRemover: (usuarioId: string) => void }
) {
  const [novo, setNovo] = useState("");
  const souCapitao = e.capitaoId === ctx.eu.id;
  const aproveitamento = linha && linha.jogos > 0 ? Math.round((linha.pontos / (linha.jogos * 3)) * 100) : null;

  return (
    <section className="cartao">
      <div className="cartao-cab">
        <Escudo nome={e.nome} tam="g" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{e.nome}</h3>
          <span className="ter">{e.membros.length} {e.membros.length === 1 ? "jogador" : "jogadores"}</span>
        </div>
        {linha && <span className="selo azul">{linha.posicao}º no ranking</span>}
      </div>

      {linha && (
        <>
          <div className="lin" style={{ gap: 18, marginBottom: 8 }}>
            <div><b style={{ fontSize: "1.05rem" }}>{linha.vitorias}</b><div className="ter">Vitórias</div></div>
            <div><b style={{ fontSize: "1.05rem" }}>{linha.empates}</b><div className="ter">Empates</div></div>
            <div><b style={{ fontSize: "1.05rem" }}>{linha.derrotas}</b><div className="ter">Derrotas</div></div>
            <div><b style={{ fontSize: "1.05rem" }}>{linha.pontos}</b><div className="ter">Pontos</div></div>
            {linha.titulos > 0 && (
              <div style={{ color: "var(--ambar)" }}><b style={{ fontSize: "1.05rem" }}>{linha.titulos}</b><div className="ter">Títulos</div></div>
            )}
          </div>
          {aproveitamento !== null && (
            <>
              <div className="lin" style={{ justifyContent: "space-between" }}>
                <span className="ter">Aproveitamento em {linha.jogos} {linha.jogos === 1 ? "jogo" : "jogos"}</span>
                <span className="ter">{aproveitamento}%</span>
              </div>
              <div className="barra verde" style={{ marginTop: 5 }}><i style={{ width: `${aproveitamento}%` }} /></div>
            </>
          )}
        </>
      )}

      <div className="sep" />
      <div className="lista">
        {e.membros.map((m) => (
          <div key={m} className="lista-item">
            <span className="avatar" style={{ width: 28, height: 28, fontSize: ".7rem" }}>
              {ctx.nomeUsuario(m).slice(0, 2).toUpperCase()}
            </span>
            <div className="cresce"><div className="nome">{ctx.nomeUsuario(m)}</div></div>
            {m === e.capitaoId
              ? <span className="selo ambar"><Crown size={12} />Capitão</span>
              : souCapitao && (
                <button className="b-fantasma b-pequeno" onClick={() => aoRemover(m)} aria-label={`Remover ${ctx.nomeUsuario(m)}`}>
                  <UserMinus size={15} />
                </button>
              )}
          </div>
        ))}
      </div>

      {souCapitao && (
        <div className="lin mt">
          <select value={novo} onChange={(ev) => setNovo(ev.target.value)} aria-label="Jogador disponível">
            <option value="">Adicionar jogador</option>
            {livres.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <button className="b-secundario" disabled={!novo}
            onClick={() => aoExecutar(async () => { await api("POST", `equipes/${e.id}/membros`, { usuarioId: novo }); setNovo(""); })}>
            Adicionar
          </button>
        </div>
      )}
      {souCapitao && livres.length === 0 && <p className="ter mt">Todos os jogadores cadastrados já estão em alguma equipe.</p>}
    </section>
  );
}
