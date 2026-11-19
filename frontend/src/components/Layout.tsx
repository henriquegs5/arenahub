import { useState } from "react";
import { Activity, Bell, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { statusServicos } from "../api";
import { usePolling } from "../hooks";
import { ROTULO_PAPEL, StatusServico, Usuario } from "../types";
import { iniciais } from "./ui";
import logo from "../assets/logo-arenahub.png";

/**
 * As páginas do novo domínio (catálogo de eventos, compra, meus ingressos,
 * validação na entrada, pedidos e administração) entram no lote 6, junto com os
 * serviços que as alimentam.
 */
export const PAGINAS = [
  { id: "visao", nome: "Visão geral", icone: LayoutDashboard },
  { id: "avisos", nome: "Notificações", icone: Bell },
] as const;
export type PaginaId = (typeof PAGINAS)[number]["id"];

const NOME_SERVICO: Record<string, string> = {
  eventos: "Eventos",
  ingressos: "Ingressos",
  pagamento: "Pagamento",
  notificacoes: "Notificações",
};

/**
 * Saúde dos serviços e estado do disjuntor de cada um, lido do Gateway.
 *
 * Fica recolhido atrás de um indicador discreto no cabeçalho: é informação de
 * diagnóstico, usada na demonstração de tolerância a falhas, e não navegação.
 */
function Saude() {
  const [st, setSt] = useState<Record<string, StatusServico> | null>(null);
  const [aberto, setAberto] = useState(false);
  usePolling(async () => { try { setSt(await statusServicos()); } catch { setSt(null); } }, 3000, []);

  const servicos = st ? Object.entries(st) : [];
  const forts = servicos.filter(([, s]) => s.servico !== "no ar").length;
  const tudoBem = !!st && forts === 0;

  return (
    <div className="saude-caixa">
      <button
        className={`saude-chip ${tudoBem ? "ok" : "alerta"}`}
        onClick={() => setAberto(!aberto)}
        aria-expanded={aberto}
        title="Estado dos serviços e dos disjuntores"
      >
        <Activity size={14} />
        <span className="saude-chip-txt">
          {!st ? "Gateway fora do ar" : tudoBem ? "Tudo no ar" : `${forts} serviço(s) fora`}
        </span>
      </button>

      {aberto && (
        <>
          <div className="capa-popover" onClick={() => setAberto(false)} />
          <div className="saude-popover" role="dialog" aria-label="Estado dos serviços">
            <div className="saude-popover-cab">
              <b>Estado do sistema</b>
              <button className="b-fantasma b-pequeno" onClick={() => setAberto(false)} aria-label="Fechar">
                <X size={14} />
              </button>
            </div>
            {!st && <div className="saude-linha"><i className="ponto erro" />Gateway fora do ar</div>}
            {servicos.map(([nome, s]) => (
              <div key={nome} className="saude-linha">
                <i className={`ponto ${s.servico === "no ar" ? "ok" : s.servico === "degradado" ? "alerta" : "erro"}`} />
                {NOME_SERVICO[nome] ?? nome}
                {s.circuito !== "FECHADO" && <span className="saude-estado">circuito {s.circuito.toLowerCase()}</span>}
              </div>
            ))}
            <p className="saude-nota">
              Cada serviço tem disjuntor próprio: a queda de um não derruba os outros.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export function Layout(
  { eu, pagina, aoTrocar, aoSair, naoLidas, children }:
  { eu: Usuario; pagina: PaginaId; aoTrocar: (p: PaginaId) => void; aoSair: () => void; naoLidas: number; children: React.ReactNode }
) {
  const [aberta, setAberta] = useState(false);
  const atual = PAGINAS.find((p) => p.id === pagina)!;
  const ir = (id: PaginaId) => { aoTrocar(id); setAberta(false); };

  return (
    <div className="app">
      <aside className={`sidebar ${aberta ? "aberta" : ""}`}>
        <div className="marca">
          {/* O logotipo já traz o nome: não se repete "ArenaHub" em texto ao lado. */}
          <img className="marca-logo" src={logo} alt="ArenaHub" width={164} height={63} />
          <span className="marca-lema">Ingressos para e-sports</span>
        </div>
        <nav className="menu">
          {PAGINAS.map((p) => (
            <button key={p.id} className={pagina === p.id ? "ativo" : ""} onClick={() => ir(p.id)} aria-current={pagina === p.id}>
              <p.icone size={17} />{p.nome}
              {p.id === "avisos" && naoLidas > 0 && <span className="conta">{naoLidas > 99 ? "99+" : naoLidas}</span>}
            </button>
          ))}
        </nav>
      </aside>
      <div className={`capa-movel ${aberta ? "ativa" : ""}`} onClick={() => setAberta(false)} />

      <div className="conteudo">
        <header className="topo">
          <button className="menu-movel" onClick={() => setAberta(true)} aria-label="Abrir menu"><Menu size={18} /></button>
          <span className="titulo-pagina">{atual.nome}</span>
          <span className="espaco" />
          <Saude />
          <button className="sino" onClick={() => ir("avisos")} aria-label="Notificações">
            <Bell size={17} />
            {naoLidas > 0 && <span className="bolha">{naoLidas > 9 ? "9+" : naoLidas}</span>}
          </button>
          <div className="usuario">
            <span className="avatar azul">{iniciais(eu.nome)}</span>
            <div className="usuario-txt">
              <b>{eu.nome}</b>
              <span>{ROTULO_PAPEL[eu.papel]}</span>
            </div>
          </div>
          <button className="b-fantasma b-pequeno" onClick={aoSair}><LogOut size={15} />Sair</button>
        </header>
        <main className="area">{children}</main>
      </div>
    </div>
  );
}
