import {
  Bell, CalendarDays, CircleDollarSign, Clock, MapPin, Ticket, TicketCheck, Users,
} from "lucide-react";
import { api } from "../api";
import { useCarregar } from "../hooks";
import { Ctx, EventoResumo, Ingresso, Notificacao, Pedido } from "../types";
import { PaginaId } from "../components/Layout";
import {
  Alerta, Carregando, Escudo, Ocupacao, PaginaTopo, Selo, Stat, Vazio,
  dataHora, desde, emReais,
} from "../components/ui";

/**
 * Visão geral. Todos os números vêm da API — nada é preenchido com dado
 * inventado. O que cada perfil vê muda conforme o que ele pode fazer.
 */
export function Visao({ ctx, ir }: { ctx: Ctx; ir: (p: PaginaId) => void }) {
  const participante = ctx.eu.papel === "PARTICIPANTE";

  const { dados, erro, carregando } = useCarregar(
    async () => {
      // Cada chamada falha por conta própria: um serviço fora do ar não apaga
      // o resto da tela.
      const [eventos, pedidos, ingressos, avisos] = await Promise.all([
        api<EventoResumo[]>("GET", "eventos?limite=100").catch(() => [] as EventoResumo[]),
        api<Pedido[]>("GET", "ingressos/pedidos?limite=100").catch(() => [] as Pedido[]),
        participante || ctx.eu.papel === "ADM"
          ? api<Ingresso[]>("GET", "ingressos?limite=100").catch(() => [] as Ingresso[])
          : Promise.resolve([] as Ingresso[]),
        api<Notificacao[]>("GET", "notificacoes/minhas?limite=6").catch(() => [] as Notificacao[]),
      ]);
      return { eventos, pedidos, ingressos, avisos };
    },
    [ctx.eu.id],
    10000
  );

  if (carregando && !dados) return <Carregando linhas={4} />;

  const eventos = dados?.eventos ?? [];
  const pedidos = dados?.pedidos ?? [];
  const ingressos = dados?.ingressos ?? [];
  const avisos = dados?.avisos ?? [];

  const meusEventos = eventos.filter((e) => e.organizadorId === ctx.eu.id);
  const relevantes = ctx.eu.papel === "ORGANIZADOR" ? meusEventos : eventos;

  const publicados = relevantes.filter((e) =>
    ["PUBLICADO", "VENDAS_ABERTAS", "VENDAS_ENCERRADAS"].includes(e.status));
  const vendendo = relevantes.filter((e) => e.status === "VENDAS_ABERTAS");
  const vendidos = relevantes.reduce((t, e) => t + e.reservados, 0);

  const concluidos = pedidos.filter((p) => p.status === "CONCLUIDO");
  const emAndamento = pedidos.filter((p) => p.emAndamento);
  const receita = concluidos.reduce((t, p) => t + p.totalCentavos, 0);

  const ingressosValidos = ingressos.filter((i) => i.status === "EMITIDO");
  const proximos = [...ingressosValidos]
    .filter((i) => i.eventoDataHora)
    .sort((a, b) => new Date(a.eventoDataHora!).getTime() - new Date(b.eventoDataHora!).getTime());

  const destaque = [...vendendo, ...publicados.filter((e) => e.status === "PUBLICADO")].slice(0, 4);

  return (
    <>
      <PaginaTopo
        titulo={`Olá, ${ctx.eu.nome.split(" ")[0]}`}
        descricao={
          ctx.eu.papel === "ORGANIZADOR"
            ? "Seus eventos, as vendas e o que precisa da sua decisão."
            : ctx.eu.papel === "ADM"
            ? "Acesso completo: contas, eventos, pedidos e pagamentos."
            : "Seus ingressos, seus pedidos e os eventos em cartaz."
        }
      />

      <Alerta texto={erro} tipo="info" />

      <div className="grade g-stats mb">
        {participante ? (
          <>
            <Stat icone={Ticket} cor="verde" valor={ingressosValidos.length} rotulo="Ingressos válidos" />
            <Stat icone={Clock} cor="ambar" valor={emAndamento.length} rotulo="Pedidos em andamento" />
            <Stat icone={CircleDollarSign} cor="azul" valor={emReais(receita)} rotulo="Total gasto" />
            <Stat icone={CalendarDays} cor="azul" valor={vendendo.length} rotulo="Eventos com vendas abertas" />
          </>
        ) : (
          <>
            <Stat icone={CalendarDays} cor="azul" valor={publicados.length} rotulo="Eventos publicados" />
            <Stat icone={TicketCheck} cor="verde" valor={vendidos} rotulo="Ingressos vendidos" />
            <Stat icone={CircleDollarSign} cor="verde" valor={emReais(receita)} rotulo="Receita confirmada" />
            <Stat icone={Clock} cor="ambar" valor={emAndamento.length} rotulo="Pedidos em andamento" />
            {ctx.eu.papel === "ADM" && (
              <Stat icone={Users} cor="azul" valor={ctx.usuarios.length} rotulo="Contas cadastradas" />
            )}
          </>
        )}
      </div>

      <div className="grade g-2">
        <div className="col" style={{ gap: 14 }}>
          <section className="cartao">
            <div className="cartao-cab">
              <h3>{ctx.eu.papel === "ORGANIZADOR" ? "Seus eventos" : "Em cartaz"}</h3>
              <button className="b-fantasma b-pequeno" onClick={() => ir("eventos")}>Ver todos</button>
            </div>

            {destaque.length === 0 ? (
              <Vazio
                icone={CalendarDays}
                titulo={ctx.eu.papel === "ORGANIZADOR" ? "Nenhum evento ativo" : "Nenhum evento em cartaz"}
                texto={
                  ctx.eu.papel === "ORGANIZADOR"
                    ? "Crie um evento, monte os setores e abra as vendas."
                    : "Quando um organizador abrir as vendas, o evento aparece aqui."
                }
                acao={
                  ctx.eu.papel === "ORGANIZADOR" ? (
                    <button className="b-primario" onClick={() => ir("eventos")}>Criar evento</button>
                  ) : undefined
                }
              />
            ) : (
              <div className="lista">
                {destaque.map((e) => (
                  <button key={e.id} className="lista-item clicavel" onClick={() => ir("eventos")}>
                    <Escudo nome={e.nome} />
                    <div className="cresce" style={{ minWidth: 0 }}>
                      <div className="nome">{e.nome}</div>
                      <div className="meta lin" style={{ gap: 6 }}>
                        <CalendarDays size={12} />{dataHora(e.dataHora)}
                        <MapPin size={12} /><span className="corta">{e.local}</span>
                      </div>
                      {e.capacidade > 0 && (
                        <div className="mt" style={{ maxWidth: 220 }}>
                          <Ocupacao reservados={e.reservados} capacidade={e.capacidade} />
                        </div>
                      )}
                    </div>
                    <Selo status={e.status} />
                  </button>
                ))}
              </div>
            )}
          </section>

          {participante && (
            <section className="cartao">
              <div className="cartao-cab">
                <h3>Seus próximos ingressos</h3>
                <button className="b-fantasma b-pequeno" onClick={() => ir("ingressos")}>Ver todos</button>
              </div>
              {proximos.length === 0 ? (
                <Vazio
                  icone={Ticket}
                  titulo="Nenhum ingresso válido"
                  texto="Compre um ingresso e ele aparece aqui, com o código de entrada."
                  acao={<button className="b-primario" onClick={() => ir("eventos")}>Ver eventos</button>}
                />
              ) : (
                <div className="lista">
                  {proximos.slice(0, 4).map((i) => (
                    <button key={i.id} className="lista-item clicavel" onClick={() => ir("ingressos")}>
                      <div className="cresce" style={{ minWidth: 0 }}>
                        <div className="nome">{i.eventoNome}</div>
                        <div className="meta">
                          {dataHora(i.eventoDataHora)} · {i.setorNome} · {i.loteNome}
                        </div>
                      </div>
                      <code style={{ fontSize: ".74rem" }}>{i.codigo}</code>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="col" style={{ gap: 14 }}>
          <section className="cartao">
            <div className="cartao-cab">
              <h3>{ctx.eu.papel === "ORGANIZADOR" ? "Vendas recentes" : "Pedidos recentes"}</h3>
              <button className="b-fantasma b-pequeno" onClick={() => ir("pedidos")}>Ver todos</button>
            </div>
            {pedidos.length === 0 ? (
              <p className="sec">
                {ctx.eu.papel === "ORGANIZADOR"
                  ? "Nenhuma venda ainda nos seus eventos."
                  : "Você ainda não fez nenhum pedido."}
              </p>
            ) : (
              <div className="lista">
                {pedidos.slice(0, 5).map((p) => (
                  <button key={p.id} className="lista-item clicavel" onClick={() => ir("pedidos")}>
                    <div className="cresce" style={{ minWidth: 0 }}>
                      <div className="nome">{p.eventoNome ?? "Evento"}</div>
                      <div className="meta">
                        {p.itens.reduce((t, i) => t + i.quantidade, 0)} ingresso(s) · {desde(p.criadoEm)}
                      </div>
                    </div>
                    <div className="col" style={{ alignItems: "flex-end", gap: 4 }}>
                      <b>{p.total}</b>
                      <Selo status={p.status} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="cartao">
            <div className="cartao-cab">
              <h3>Avisos recentes</h3>
              <button className="b-fantasma b-pequeno" onClick={() => ir("avisos")}>Ver todos</button>
            </div>
            {avisos.length === 0 ? (
              <p className="sec">
                <Bell size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                Nenhum aviso ainda.
              </p>
            ) : (
              <div className="lista">
                {avisos.map((n) => (
                  <button key={n.id} className="lista-item clicavel" onClick={() => ir("avisos")}>
                    <div className="cresce" style={{ minWidth: 0 }}>
                      <div className="nome">{n.titulo}</div>
                      <div className="meta corta-2">{n.mensagem}</div>
                    </div>
                    <span className="tempo">{desde(n.criadoEm)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
