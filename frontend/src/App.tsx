import { useEffect, useState } from "react";
import { api, setAoNaoAutorizado, setToken } from "./api";
import { Layout, PaginaId } from "./components/Layout";
import { usePolling } from "./hooks";
import { Avisos } from "./pages/Avisos";
import { Login, Sessao } from "./pages/Login";
import { Visao } from "./pages/Visao";
import { Ctx, Usuario } from "./types";

const CHAVE = "arenahub.sessao";

/**
 * O controle de leitura dos avisos vivia aqui, no navegador, o que estava
 * errado: sumia ao trocar de maquina e discordava entre abas. Agora e do
 * backend. Esta limpeza descarta o resto da versao antiga, uma unica vez.
 */
try { localStorage.removeItem("arenahub.avisosLidos"); } catch { /* ignora */ }

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

  /**
   * Contador de avisos nao lidos, exibido na barra lateral e no cabecalho.
   * O backend responde so um numero: a tela nao baixa a lista inteira para contar.
   */
  usePolling(async () => {
    if (!sessao) return;
    try {
      const r = await api<{ naoLidas: number }>("GET", "notificacoes/contador");
      setNaoLidas(r.naoLidas);
    } catch { /* servico de notificacoes indisponivel: o resto continua */ }
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
