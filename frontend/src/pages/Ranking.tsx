import { useEffect, useState } from "react";
import { Crown, Trophy } from "lucide-react";
import { api } from "../api";
import { usePolling, useTorneios } from "../hooks";
import { Ctx, LinhaRanking } from "../types";
import { Alerta, Escudo, PaginaTopo, Vazio } from "../components/ui";

export function Ranking({ ctx }: { ctx: Ctx }) {
  const { torneios } = useTorneios();
  const [sel, setSel] = useState("geral");
  const [linhas, setLinhas] = useState<LinhaRanking[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { setLinhas([]); }, [sel]);
  usePolling(async () => {
    try {
      setLinhas(await api<LinhaRanking[]>("GET", sel === "geral" ? "ranking/geral" : `ranking/torneios/${sel}`));
      setErro(null);
    } catch (e) {
      setErro(`${(e as Error).message}. As outras páginas continuam funcionando normalmente.`);
    }
  }, 4000, [sel]);

  const geral = sel === "geral";
  const podio = linhas.slice(0, 3);
  const maxPts = Math.max(1, ...linhas.map((l) => l.pontos));

  return (
    <>
      <PaginaTopo
        titulo="Ranking"
        descricao={geral
          ? "Desempenho acumulado de todas as equipes, somando pontos e títulos de todos os campeonatos."
          : "Classificação das equipes dentro deste campeonato."}
        acoes={
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ minWidth: 220 }} aria-label="Tipo de ranking">
            <option value="geral">Ranking geral</option>
            {torneios.map((t) => <option key={t.id} value={t.id}>Classificação de {t.nome}</option>)}
          </select>
        }
      />

      <Alerta texto={erro} />

      {linhas.length === 0 && !erro && (
        <Vazio icone={Trophy} titulo="Sem classificação ainda"
          texto="A tabela é montada a partir dos resultados confirmados. Assim que a primeira partida for confirmada, ela aparece aqui." />
      )}

      {podio.length >= 2 && (
        <div className="podio">
          {[podio[1], podio[0], podio[2]].map((l, i) => {
            if (!l) return <div key={i} />;
            const pos = l.posicao;
            return (
              <div key={l.equipeId} className={`podio-item p${pos}`}>
                {pos === 1 && <Crown size={18} className="coroa" />}
                <div className="podio-pos">{pos}º lugar</div>
                <div className="lin" style={{ justifyContent: "center", marginTop: 8 }}>
                  <Escudo nome={l.nome ?? ctx.nomeEquipe(l.equipeId)} tam={pos === 1 ? "g" : ""} />
                </div>
                <div className="podio-nome">{l.nome ?? ctx.nomeEquipe(l.equipeId)}</div>
                <div className="podio-pts">
                  {l.pontos} {l.pontos === 1 ? "ponto" : "pontos"}
                  {geral && l.titulos > 0 && <> · {l.titulos} {l.titulos === 1 ? "título" : "títulos"}</>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {linhas.length > 0 && (
        <div className="tabela-caixa">
          <div className="rolagem">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Equipe</th><th>J</th><th>V</th><th>E</th><th>D</th>
                  <th>GP</th><th>GC</th><th>SG</th><th>Pts</th>{geral && <th>Títulos</th>}<th>Aproveitamento</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.equipeId} className={l.posicao === 1 ? "lider" : ""}>
                    <td>{l.posicao}</td>
                    <td>
                      <span className="lin" style={{ gap: 9 }}>
                        <Escudo nome={l.nome ?? "?"} tam="p" />
                        {l.nome ?? ctx.nomeEquipe(l.equipeId)}
                      </span>
                    </td>
                    <td>{l.jogos}</td><td>{l.vitorias}</td><td>{l.empates}</td><td>{l.derrotas}</td>
                    <td>{l.golsPro}</td><td>{l.golsContra}</td>
                    <td>{l.saldo > 0 ? `+${l.saldo}` : l.saldo}</td>
                    <td className="destaque">{l.pontos}</td>
                    {geral && <td>{l.titulos > 0 ? l.titulos : "—"}</td>}
                    <td style={{ width: 120 }}>
                      <div className="barra"><i style={{ width: `${(l.pontos / maxPts) * 100}%` }} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {linhas.length > 0 && (
        <p className="ter mt">
          J jogos · V vitórias · E empates · D derrotas · GP pontos feitos · GC pontos sofridos · SG saldo
        </p>
      )}
    </>
  );
}
