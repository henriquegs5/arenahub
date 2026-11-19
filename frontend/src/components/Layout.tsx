import { useState } from "react";
import {
  Activity, Bell, CalendarDays, LayoutDashboard, LogOut, Menu, QrCode,
  Receipt, ServerCog, Ticket, UserCircle, Users, X,
} from "lucide-react";
import { statusServicos } from "../api";
import { usePolling } from "../hooks";
import { Papel, ROTULO_PAPEL, StatusServico, Usuario } from "../types";
import { iniciais } from "./ui";
import logo from "../assets/logo-arenahub.png";

/**
 * Navegação por perfil. Cada item declara quem o vê; o backend confere de novo
 * em toda chamada — esconder o item só evita oferecer o que seria recusado.
 */
export const PAGINAS = [
  { id: "visao", nome: "Visão geral", icone: LayoutDashboard, papeis: ["PARTICIPANTE", "ORGANIZADOR", "ADM"] },
  { id: "eventos", nome: "Eventos", icone: CalendarDays, papeis: ["PARTICIPANTE", "ORGANIZADOR", "ADM"] },
  { id: "ingressos", nome: "Meus ingressos", icone: Ticket, papeis: ["PARTICIPANTE", "ADM"] },
  { id: "pedidos", nome: "Pedidos", icone: Receipt, papeis: ["PARTICIPANTE", "ORGANIZADOR", "ADM"] },
  { id: "validar", nome: "Validar entrada", icone: QrCode, papeis: ["ORGANIZADOR", "ADM"] },
  { id: "avisos", nome: "Notificações", icone: Bell, papeis: ["PARTICIPANTE", "ORGANIZADOR", "ADM"] },
  { id: "usuarios", nome: "Usuários", icone: Users, papeis: ["ADM"] },
  { id: "sistema", nome: "Sistema", icone: ServerCog, papeis: ["ADM"] },
  { id: "conta", nome: "Minha conta", icone: UserCircle, papeis: ["PARTICIPANTE", "ORGANIZADOR", "ADM"] },
] as const;

export type PaginaId = (typeof PAGINAS)[number]["id"];

export const paginasDe = (papel: Papel) =>
  PAGINAS.filter((p) => (p.papeis as readonly string[]).includes(papel));

/** O rótulo de "Pedidos" muda de sentido conforme quem olha. */
export function nomeDaPagina(id: PaginaId, papel: Papel): string {
  if (id === "pedidos") return papel === "ORGANIZADOR" ? "Vendas" : "Pedidos";
  return PAGINAS.find((p) => p.id === id)!.nome;
}

const NOME_SERVICO: Record<string, string> = {
  eventos: "Eventos", ingressos: "Ingressos",
  pagamento: "Pagamento", notificacoes: "Notificações",
};

/**
 * Saúde dos serviços e estado do disjuntor de cada um, lido do Gateway.
 *
 * Fica recolhido atrás de um indicador discreto no cabeçalho: é informação de
 * diagnóstico, usada na demonstração de tolerância a falhas, e não navegação.
 */
export function Saude() {
  const [st, setSt] = useState<Record<string, StatusServico> | null>(null);
  const [aberto, setAberto] = useState(false);
  usePolling(async () => { try { setSt(await statusServicos()); } catch { setSt(null); } }, 3000, []);

  const servicos = st ? Object.entries(st) : [];
  const fora = servicos.filter(([, s]) => s.servico !== "no ar").length;
  const tudoBem = !!st && fora === 0;

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
          {!st ? "Gateway fora do ar" : tudoBem ? "Tudo no ar" : `${fora} serviço(s) fora`}
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
  {
    eu: Usuario; pagina: PaginaId; aoTrocar: (p: PaginaId) => void;
    aoSair: () => void; naoLidas: number; children: React.ReactNode;
  }
) {
  const [aberta, setAberta] = useState(false);
  const itens = paginasDe(eu.papel);
  const atual = itens.find((p) => p.id === pagina) ?? itens[0];
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
          {itens.map((p) => (
            <button
              key={p.id}
              className={pagina === p.id ? "ativo" : ""}
              onClick={() => ir(p.id)}
              aria-current={pagina === p.id ? "page" : undefined}
            >
              <p.icone size={17} />{nomeDaPagina(p.id, eu.papel)}
              {p.id === "avisos" && naoLidas > 0 && (
                <span className="conta">{naoLidas > 99 ? "99+" : naoLidas}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>
      <div className={`capa-movel ${aberta ? "ativa" : ""}`} onClick={() => setAberta(false)} />

      <div className="conteudo">
        <header className="topo">
          <button className="menu-movel" onClick={() => setAberta(true)} aria-label="Abrir menu">
            <Menu size={18} />
          </button>
          <span className="titulo-pagina">{nomeDaPagina(atual.id, eu.papel)}</span>
          <span className="espaco" />
          <Saude />
          <button className="sino" onClick={() => ir("avisos")} aria-label={`Notificações: ${naoLidas} não lidas`}>
            <Bell size={17} />
            {naoLidas > 0 && <span className="bolha">{naoLidas > 9 ? "9+" : naoLidas}</span>}
          </button>
          <button className="usuario" onClick={() => ir("conta")} title="Minha conta">
            <span className="avatar azul">{iniciais(eu.nome)}</span>
            <div className="usuario-txt">
              <b>{eu.nome}</b>
              <span>{ROTULO_PAPEL[eu.papel]}</span>
            </div>
          </button>
          <button className="b-fantasma b-pequeno" onClick={aoSair}><LogOut size={15} />Sair</button>
        </header>
        <main className="area">{children}</main>
      </div>
    </div>
  );
}
