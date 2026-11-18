import { useState } from "react";
import {
  Bell, LayoutDashboard, LogOut, Menu, Shield, Swords, Trophy, Users, Activity, Gamepad2,
} from "lucide-react";
import { statusServicos } from "../api";
import { usePolling } from "../hooks";
import { StatusServico, Usuario } from "../types";
import { iniciais } from "./ui";

export const PAGINAS = [
  { id: "visao", nome: "Visão geral", icone: LayoutDashboard },
  { id: "torneios", nome: "Torneios", icone: Trophy },
  { id: "equipes", nome: "Equipes", icone: Shield },
  { id: "partidas", nome: "Partidas", icone: Swords },
  { id: "ranking", nome: "Ranking", icone: Users },
  { id: "avisos", nome: "Notificações", icone: Bell },
] as const;
export type PaginaId = (typeof PAGINAS)[number]["id"];

const NOME_SERVICO: Record<string, string> = {
  identidade: "Identidade", equipes: "Equipes", torneios: "Torneios",
  partidas: "Partidas", ranking: "Ranking", notificacoes: "Notificações",
};

/** Saúde dos serviços e estado do disjuntor de cada um, lido do Gateway. */
function Saude() {
  const [st, setSt] = useState<Record<string, StatusServico> | null>(null);
  usePolling(async () => { try { setSt(await statusServicos()); } catch { setSt(null); } }, 3000, []);

  return (
    <div className="saude">
      <div className="saude-topo"><Activity size={13} />Serviços</div>
      {!st && <div className="saude-linha"><i className="ponto erro" />Gateway fora do ar</div>}
      {st && Object.entries(st).map(([nome, s]) => (
        <div key={nome} className="saude-linha">
          <i className={`ponto ${s.servico === "no ar" ? "ok" : s.servico === "degradado" ? "alerta" : "erro"}`} />
          {NOME_SERVICO[nome] ?? nome}
          {s.circuito !== "FECHADO" && <span className="saude-estado">circuito {s.circuito.toLowerCase()}</span>}
        </div>
      ))}
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
          <span className="marca-icone"><Gamepad2 size={18} /></span>
          <div><b>ArenaHub</b><span>Campeonatos de e-sports</span></div>
        </div>
        <nav className="menu">
          {PAGINAS.map((p) => (
            <button key={p.id} className={pagina === p.id ? "ativo" : ""} onClick={() => ir(p.id)} aria-current={pagina === p.id}>
              <p.icone size={17} />{p.nome}
              {p.id === "avisos" && naoLidas > 0 && <span className="conta">{naoLidas > 99 ? "99+" : naoLidas}</span>}
            </button>
          ))}
        </nav>
        <Saude />
      </aside>
      <div className={`capa-movel ${aberta ? "ativa" : ""}`} onClick={() => setAberta(false)} />

      <div className="conteudo">
        <header className="topo">
          <button className="menu-movel" onClick={() => setAberta(true)} aria-label="Abrir menu"><Menu size={18} /></button>
          <span className="titulo-pagina">{atual.nome}</span>
          <span className="espaco" />
          <button className="sino" onClick={() => ir("avisos")} aria-label="Notificações">
            <Bell size={17} />
            {naoLidas > 0 && <span className="bolha">{naoLidas > 9 ? "9+" : naoLidas}</span>}
          </button>
          <div className="usuario">
            <span className="avatar azul">{iniciais(eu.nome)}</span>
            <div className="usuario-txt">
              <b>{eu.nome}</b>
              <span>{eu.papel === "ORGANIZADOR" ? "Organizador" : "Jogador"}</span>
            </div>
          </div>
          <button className="b-fantasma b-pequeno" onClick={aoSair}><LogOut size={15} />Sair</button>
        </header>
        <main className="area">{children}</main>
      </div>
    </div>
  );
}
