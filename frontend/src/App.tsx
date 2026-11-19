import { useCallback, useEffect, useState } from "react";
import { api, setAoNaoAutorizado, setToken } from "./api";
import { Layout, PaginaId, paginasDe } from "./components/Layout";
import { usePolling } from "./hooks";
import { Avisos } from "./pages/Avisos";
import { Conta } from "./pages/Conta";
import { Eventos } from "./pages/Eventos";
import { Login, Sessao } from "./pages/Login";
import { MeusIngressos } from "./pages/MeusIngressos";
import { Pedidos } from "./pages/Pedidos";
import { Sistema } from "./pages/Sistema";
import { Usuarios } from "./pages/Usuarios";
import { Validar } from "./pages/Validar";
import { Visao } from "./pages/Visao";
import { Ctx, Usuario } from "./types";

const CHAVE = "arenahub.sessao";

/**
 * O controle de leitura dos avisos vivia aqui, no navegador, o que estava
 * errado: sumia ao trocar de máquina e discordava entre abas. Agora é do
 * backend. Esta limpeza descarta o resto da versão antiga, uma única vez.
 */
try { localStorage.removeItem("arenahub.avisosLidos"); } catch { /* ignora */ }

function lerSessao(): Sessao | null {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Sessao | null;
    // Sessão de uma versão antiga (ex.: papel JOGADOR) não tem menu nem páginas:
    // descarta e volta ao login, em vez de quebrar a renderização.
    if (s && !["PARTICIPANTE", "ORGANIZADOR", "ADM"].includes(s.usuario?.papel)) {
      localStorage.removeItem(CHAVE);
      return null;
    }
    if (s) setToken(s.token); // antes de qualquer tela buscar dados
    return s;
  } catch { return null; }
}

export default function App() {
  const [sessao, setSessao] = useState<Sessao | null>(lerSessao);
  const [pagina, setPagina] = useState<PaginaId>("visao");
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [versaoAvisos, setVersaoAvisos] = useState(0);

  const sair = useCallback(() => {
    setToken(null);
    try { localStorage.removeItem(CHAVE); } catch { /* ignora */ }
    setSessao(null);
    setUsuarios([]);
    setNaoLidas(0);
  }, []);

  // Token expirado no meio do uso: volta ao login em vez de falhar em silêncio.
  useEffect(() => { setAoNaoAutorizado(sair); return () => setAoNaoAutorizado(null); }, [sair]);

  const entrar = (s: Sessao) => {
    setToken(s.token);
    try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch { /* ignora */ }
    setSessao(s);
    setPagina("visao");
  };

  /**
   * Catálogo de nomes, buscado UMA VEZ por sessão (e sob demanda).
   * A versão antiga refazia um GET por entidade a cada ciclo de atualização, o
   * que não escalava; o catálogo inteiro sai do Gateway numa chamada só.
   */
  const recarregar = useCallback(async () => {
    try { setUsuarios(await api<Usuario[]>("GET", "auth/usuarios")); }
    catch { /* mantém o último catálogo conhecido */ }
  }, []);

  useEffect(() => { if (sessao) void recarregar(); }, [sessao?.token, recarregar]);

  /**
   * Contador de avisos não lidos, no cabeçalho e na barra lateral.
   * O backend responde só um número: a tela não baixa a lista para contar.
   */
  usePolling(async () => {
    if (!sessao) return;
    try {
      const r = await api<{ naoLidas: number }>("GET", "notificacoes/contador");
      setNaoLidas(r.naoLidas);
    } catch { /* serviço de notificações indisponível: o resto continua */ }
  }, 5000, [sessao?.token, versaoAvisos]);

  if (!sessao) return <Login aoEntrar={entrar} />;

  const ctx: Ctx = {
    eu: sessao.usuario,
    usuarios,
    recarregar,
    avisarMudanca: () => setVersaoAvisos((v) => v + 1),
    nomeUsuario: (id) =>
      usuarios.find((u) => u.id === id)?.nome ?? (id ? `Usuário ${id.slice(0, 4)}` : "—"),
  };

  // O perfil pode ter mudado (o ADM rebaixou alguém): se a página atual não é
  // mais permitida, volta à visão geral em vez de mostrar uma tela vazia.
  const permitidas = paginasDe(sessao.usuario.papel).map((p) => p.id as PaginaId);
  const atual: PaginaId = permitidas.includes(pagina) ? pagina : "visao";

  return (
    <Layout
      eu={sessao.usuario}
      pagina={atual}
      aoTrocar={setPagina}
      aoSair={sair}
      naoLidas={naoLidas}
    >
      {atual === "visao" && <Visao ctx={ctx} ir={setPagina} />}
      {atual === "eventos" && <Eventos ctx={ctx} />}
      {atual === "ingressos" && <MeusIngressos ctx={ctx} />}
      {atual === "pedidos" && <Pedidos ctx={ctx} />}
      {atual === "validar" && <Validar ctx={ctx} />}
      {atual === "avisos" && <Avisos aoMudarLidas={ctx.avisarMudanca} />}
      {atual === "usuarios" && <Usuarios ctx={ctx} />}
      {atual === "sistema" && <Sistema />}
      {atual === "conta" && <Conta ctx={ctx} aoSair={sair} />}
    </Layout>
  );
}
