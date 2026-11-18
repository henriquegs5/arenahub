import { useEffect, useState } from "react";
import { api } from "./api";
import { usePolling, useTorneios } from "./hooks";
import { Alerta } from "./ui";
import { LinhaRanking } from "./types";

export function Ranking() {
  const { torneios } = useTorneios();
  const [sel, setSel] = useState("geral");
  const [linhas, setLinhas] = useState<LinhaRanking[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { setLinhas([]); }, [sel]);
  usePolling(async () => {
    try { setLinhas(await api<LinhaRanking[]>("GET", sel === "geral" ? "ranking/geral" : `ranking/torneios/${sel}`)); setErro(null); }
    catch (e) { setErro(`${(e as Error).message}. O restante do sistema continua funcionando.`); }
  }, 3000, [sel]);

  return (
    <>
      <div className="linha">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="geral">Ranking geral</option>
          {torneios.map((t) => <option key={t.id} value={t.id}>Classificação · {t.nome}</option>)}
        </select>
      </div>
      <Alerta texto={erro} />
      {linhas.length === 0 && !erro && <p className="dica">Sem dados ainda.</p>}
      {linhas.length > 0 && (
        <table>
          <thead>
            <tr><th>#</th><th>Equipe</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>Pts</th>{sel === "geral" && <th>Títulos</th>}</tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.equipeId}>
                <td>{l.posicao}</td><td>{l.nome ?? l.equipeId.slice(0, 8)}</td>
                <td>{l.jogos}</td><td>{l.vitorias}</td><td>{l.empates}</td><td>{l.derrotas}</td>
                <td>{l.golsPro}</td><td>{l.golsContra}</td><td>{l.saldo}</td><td><b>{l.pontos}</b></td>
                {sel === "geral" && <td>{l.titulos > 0 ? `🏆 ${l.titulos}` : 0}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
