import { useEffect, useState } from "react";
import { api, setAoNaoAutorizado, setToken } from "./api";
import { Layout, PaginaId } from "./components/Layout";
import { usePolling } from "./hooks";
import { Avisos, lerLidas } from "./pages/Avisos";
import { Login, Sessao } from "./pages/Login";
import { Visao } from "./pages/Visao";
import { Ctx, Notificacao, Usuario } from "./types";

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

  /**
   * Catálogo de nomes, buscado UMA VEZ por sessão (e sob demanda via recarregar).
   * A versão antiga refazia um GET por entidade a cada ciclo de atualização, o
   * que não escalava; o catálogo completo sai do Gateway numa chamada só.
   */
  const recarregar = async () => {
    if (!sessao) return;
    try { setUsuarios(await api<Usuario[]>("GET", "auth/usuarios")); }
    catch { /* mantém o último catálogo conhecido */ }
  };
  useEffect(() => { void recarregar(); }, [sessao?.token]);

  // Contador de avisos não lidos, exibido na barra lateral e no cabeçalho.
  usePolling(async () => {
    if (!sessao) return;
    try {
      const todos = await api<Notificacao[]>("GET", "notificacoes/minhas?limite=50");
      const lidas = lerLidas();
      setNaoLidas(todos.filter((n) => !lidas.has(n.id)).length);
    } catch { /* serviço de notificações indisponível: o resto continua */ }
  }, 5000, [sessao?.token, versaoLidas]);

  if (!sessao) return <Login aoEntrar={entrar} />;

  const ctx: Ctx = {
    eu: sessao.usuario,
    usuarios,
    recarregar,
    nomeUsuario: (id) => usuarios.find((u) => u.id === id)?.nome ?? (id ? `Usuário ${id.slice(0, 4)}` : "—"),
  };

  return (
    <Layout eu={sessao.usuario} pagina={pagina} aoTrocar={setPagina} aoSair={sair} naoLidas={naoLidas}>
      {pagina === "visao" && <Visao ctx={ctx} ir={setPagina} />}
      {pagina === "avisos" && <Avisos aoMudarLidas={() => setVersaoLidas((v) => v + 1)} />}
    </Layout>
  );
}
