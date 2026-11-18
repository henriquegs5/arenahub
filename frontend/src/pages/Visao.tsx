import { useState } from "react";
import { Activity, CalendarClock, Shield, Swords, Trophy, Users } from "lucide-react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { Ctx, LinhaRanking, Notificacao, Partida, Torneio } from "../types";
import { PaginaId } from "../components/Layout";
import { Alerta, Escudo, PaginaTopo, ROTULO_FORMATO, Selo, Stat, Vazio, desde } from "../components/ui";

export function Visao({ ctx, ir }: { ctx: Ctx; ir: (p: PaginaId) => void }) {
  const [torneios, setTorneios] = useState<Torneio[]>([]);
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [ranking, setRanking] = useState<LinhaRanking[]>([]);
  const [avisos, setAvisos] = useState<Notificacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  usePolling(async () => {
    const [t, p] = await Promise.all([
      api<Torneio[]>("GET", "torneios").catch(() => null),
      api<Partida[]>("GET", "partidas").catch(() => null),
    ]);
    if (t) setTorneios(t);
    if (p) setPartidas(p);
    setErro(t && p ? null : "Alguns dados não puderam ser carregados. O restante continua disponível.");
    // Ranking e avisos podem estar indisponíveis sem afetar o resto da página.
    try { setRanking(await api<LinhaRanking[]>("GET", "ranking/geral")); } catch { setRanking([]); }
    try { setAvisos(await api<Notificacao[]>("GET", "notificacoes?limite=6")); } catch { setAvisos([]); }
  }, 5000, []);

  const emAndamento = torneios.filter((t) => t.status === "EM_ANDAMENTO");
  const abertos = torneios.filter((t) => t.status === "INSCRICOES_ABERTAS");
  const destaque = [...emAndamento, ...abertos].slice(0, 4);
  const pendentes = partidas.filter((p) => p.status !== "CONFIRMADA");
  const jogadas = partidas.filter((p) => p.status === "CONFIRMADA");
  const ultimas = [...jogadas].reverse().slice(0, 5);

  return (
    <>
      <PaginaTopo
        titulo={`Olá, ${ctx.eu.nome.split(" ")[0]}`}
        descricao={ctx.eu.papel === "ORGANIZADOR"
          ? "Acompanhe os campeonatos que você conduz e o que precisa da sua decisão."
          : "Acompanhe seus torneios, partidas e a posição da sua equipe."}
      />
      <Alerta texto={erro} tipo="info" />

      <div className="grade g-stats mb">
        <Stat icone={Trophy} cor="azul" valor={torneios.length} rotulo="Torneios criados" />
        <Stat icone={Activity} cor="ambar" valor={emAndamento.length} rotulo="Em andamento" />
        <Stat icone={Shield} cor="azul" valor={ctx.equipes.length} rotulo="Equipes" />
        <Stat icone={Users} cor="verde" valor={ctx.usuarios.length} rotulo="Jogadores e organizadores" />
        <Stat icone={Swords} cor="verde" valor={jogadas.length} rotulo="Partidas concluídas" />
        <Stat icone={CalendarClock} cor="vermelho" valor={pendentes.length} rotulo="Partidas em aberto" />
      </div>

      <div className="grade g-2">
        <div className="col">
          <section className="cartao">
            <div className="cartao-cab">
              <h3>Competições em destaque</h3>
              <button className="b-fantasma b-pequeno" onClick={() => ir("torneios")}>Ver todos</button>
            </div>
            {destaque.length === 0
              ? <Vazio icone={Trophy} titulo="Nenhuma competição ativa"
                  texto={ctx.eu.papel === "ORGANIZADOR" ? "Crie um torneio e abra as inscrições para começar." : "Quando um organizador abrir inscrições, o torneio aparece aqui."}
                  acao={ctx.eu.papel === "ORGANIZADOR" ? <button className="b-primario" onClick={() => ir("torneios")}>Criar torneio</button> : undefined} />
              : (
                <div className="lista">
                  {destaque.map((t) => (
                    <div key={t.id} className="lista-item">
                      <Escudo nome={t.nome} />
                      <div className="cresce">
                        <div className="nome">{t.nome}</div>
                        <div className="meta">{ROTULO_FORMATO[t.formato]} · até {t.maxEquipes} equipes</div>
                      </div>
                      <Selo status={t.status} />
                    </div>
                  ))}
                </div>
              )}
          </section>

          <section className="cartao">
            <div className="cartao-cab">
              <h3>Resultados recentes</h3>
              <button className="b-fantasma b-pequeno" onClick={() => ir("partidas")}>Ver partidas</button>
            </div>
            {ultimas.length === 0
              ? <Vazio icone={Swords} titulo="Ainda sem resultados" texto="As partidas aparecem aqui assim que um torneio é iniciado e os resultados são confirmados." />
              : (
                <div className="lista">
                  {ultimas.map((p) => {
                    const venceuA = (p.placarA ?? 0) > (p.placarB ?? 0);
                    const empate = p.placarA === p.placarB;
                    return (
                      <div key={p.id} className="lista-item">
                        <div className="cresce">
                          <div className="nome">
                            <span style={{ color: !empate && venceuA ? "var(--verde)" : undefined }}>{ctx.nomeEquipe(p.equipeAId)}</span>
                            <span className="ter"> {p.placarA} x {p.placarB} </span>
                            <span style={{ color: !empate && !venceuA ? "var(--verde)" : undefined }}>{ctx.nomeEquipe(p.equipeBId)}</span>
                          </div>
                          <div className="meta">{ctx.nomeTorneio(p.torneioId)} · rodada {p.rodada}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
          </section>
        </div>

        <div className="col">
          <section className="cartao">
            <div className="cartao-cab">
              <h3>Melhores equipes</h3>
              <button className="b-fantasma b-pequeno" onClick={() => ir("ranking")}>Ranking</button>
            </div>
            {ranking.length === 0
              ? <p className="sec">A classificação aparece quando os primeiros resultados forem confirmados.</p>
              : (
                <div className="lista">
                  {ranking.slice(0, 5).map((l) => (
                    <div key={l.equipeId} className="lista-item">
                      <span className="ter" style={{ width: 16 }}>{l.posicao}</span>
                      <Escudo nome={l.nome ?? "?"} tam="p" />
                      <div className="cresce">
                        <div className="nome">{l.nome ?? ctx.nomeEquipe(l.equipeId)}</div>
                        <div className="meta">{l.vitorias}V · {l.empates}E · {l.derrotas}D</div>
                      </div>
                      <b>{l.pontos} pts</b>
                    </div>
                  ))}
                </div>
              )}
          </section>

          <section className="cartao">
            <div className="cartao-cab">
              <h3>Atividade recente</h3>
              <button className="b-fantasma b-pequeno" onClick={() => ir("avisos")}>Ver tudo</button>
            </div>
            {avisos.length === 0
              ? <p className="sec">Nenhuma movimentação ainda.</p>
              : (
                <div className="lista">
                  {avisos.map((n) => (
                    <div key={n.id} className="lista-item">
                      <div className="cresce">
                        <div className="nome">{n.titulo}</div>
                        <div className="meta">{n.mensagem}</div>
                      </div>
                      <span className="tempo">{desde(n.criadoEm)}</span>
                    </div>
                  ))}
                </div>
              )}
          </section>
        </div>
      </div>
    </>
  );
}
