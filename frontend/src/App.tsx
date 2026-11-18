import { useEffect, useState } from "react";
import { api, setAoNaoAutorizado, setToken } from "./api";
import { Layout, PaginaId } from "./components/Layout";
import { usePolling } from "./hooks";
import { Avisos, lerLidas } from "./pages/Avisos";
import { Equipes } from "./pages/Equipes";
import { Login, Sessao } from "./pages/Login";
import { Partidas } from "./pages/Partidas";
import { Ranking } from "./pages/Ranking";
import { Torneios } from "./pages/Torneios";
import { Visao } from "./pages/Visao";
import { Ctx, Equipe, Notificacao, Torneio, Usuario } from "./types";

const CHAVE = "arenahub.sessao";

function lerSessao(): Sessao | null {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Sessao | null;
    if (s) setToken(s.token); // antes de qualquer tela buscar dados
    return s;
  } catch { return null; }
}

export default function App() {
  const [sessao, setSessao] = useState<Sessao | null>(lerSessao);
  const [pagina, setPagina] = useState<PaginaId>("visao");
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [equipes, setEquipes] = useState<Equipe[]>([]);
  const [torneios, setTorneios] = useState<Torneio[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [versaoLidas, setVersaoLidas] = useState(0);

  const sair = () => {
    setToken(null);
    try { localStorage.removeItem(CHAVE); } catch { /* ignora */ }
    setSessao(null);
  };
  useEffect(() => { setAoNaoAutorizado(sair); return () => setAoNaoAutorizado(null); }, []);

  const entrar = (s: Sessao) => {
    setToken(s.token);
    try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch { /* ignora */ }
    setSessao(s); setPagina("visao");
  };

  // Catálogo de nomes (usuários, equipes e torneios) usado por todas as telas.
  const recarregar = async () => {
    try {
      const [u, lista] = await Promise.all([api<Usuario[]>("GET", "identidade/usuarios"), api<Equipe[]>("GET", "equipes")]);
      setUsuarios(u);
      setEquipes(await Promise.all(lista.map((e) => api<Equipe>("GET", `equipes/${e.id}`))));
    } catch { /* mantém o último catálogo conhecido */ }
    try { setTorneios(await api<Torneio[]>("GET", "torneios")); } catch { /* idem */ }
  };
  usePolling(async () => { if (sessao) await recarregar(); }, 6000, [sessao?.token]);

  // Contador de avisos não lidos, exibido na barra lateral e no cabeçalho.
  usePolling(async () => {
    if (!sessao) return;
    try {
      const todos = await api<Notificacao[]>("GET", "notificacoes?limite=50");
      const lidas = lerLidas();
      setNaoLidas(todos.filter((n) => !lidas.has(n.id)).length);
    } catch { /* serviço de notificações indisponível */ }
  }, 5000, [sessao?.token, versaoLidas]);

  if (!sessao) return <Login aoEntrar={entrar} />;

  const ctx: Ctx = {
    eu: sessao.usuario, usuarios, equipes, recarregar,
    nomeUsuario: (id) => usuarios.find((u) => u.id === id)?.nome ?? (id ? `Usuário ${id.slice(0, 4)}` : "—"),
    nomeEquipe: (id) => equipes.find((e) => e.id === id)?.nome ?? (id ? `Equipe ${id.slice(0, 4)}` : "—"),
    nomeTorneio: (id) => torneios.find((t) => t.id === id)?.nome ?? "Torneio",
  };

  return (
    <Layout eu={sessao.usuario} pagina={pagina} aoTrocar={setPagina} aoSair={sair} naoLidas={naoLidas}>
      {pagina === "visao" && <Visao ctx={ctx} ir={setPagina} />}
      {pagina === "torneios" && <Torneios ctx={ctx} />}
      {pagina === "equipes" && <Equipes ctx={ctx} />}
      {pagina === "partidas" && <Partidas ctx={ctx} />}
      {pagina === "ranking" && <Ranking ctx={ctx} />}
      {pagina === "avisos" && <Avisos aoMudarLidas={() => setVersaoLidas((v) => v + 1)} />}
    </Layout>
  );
}
