import { useEffect, useState } from "react";
import { api } from "./api";
import { usePolling, useTorneios } from "./hooks";
import { Notificacao } from "./types";
import { Alerta, hora } from "./ui";

export function Notificacoes() {
  const { torneios } = useTorneios();
  const [modo, setModo] = useState("geral");
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { setItens([]); }, [modo]);
  usePolling(async () => {
    const caminho = modo === "minhas" ? "notificacoes/minhas?limite=30"
      : modo === "geral" ? "notificacoes?limite=30" : `notificacoes?torneioId=${modo}&limite=30`;
    try { setItens(await api<Notificacao[]>("GET", caminho)); setErro(null); }
    catch (e) { setErro(`${(e as Error).message}. O restante do sistema continua funcionando.`); }
  }, 3000, [modo]);

  return (
    <>
      <div className="linha">
        <select value={modo} onChange={(e) => setModo(e.target.value)}>
          <option value="geral">Todos os avisos</option>
          <option value="minhas">Meus avisos</option>
          {torneios.map((t) => <option key={t.id} value={t.id}>Torneio · {t.nome}</option>)}
        </select>
      </div>
      <Alerta texto={erro} />
      {itens.length === 0 && !erro && <p className="dica">Nenhum aviso.</p>}
      <ul className="feed">
        {itens.map((n) => (
          <li key={n.id}>
            <span className="hora">{hora(n.criadoEm)}</span>
            <div><b>{n.titulo}</b><br />{n.mensagem}</div>
          </li>
        ))}
      </ul>
    </>
  );
}
