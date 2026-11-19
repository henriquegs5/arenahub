import { useState } from "react";
import { ChevronDown, ChevronUp, Receipt, Undo2 } from "lucide-react";
import { api } from "../api";
import { useAcao, useCarregar } from "../hooks";
import { Ctx, LinhaHistorico, Pedido, StatusPedido, Transacao } from "../types";
import {
  Alerta, Carregando, Confirmacao, Girando, PaginaTopo, ROTULO_COMANDO,
  ROTULO_MEIO, Selo, Vazio, dataHora, desde, emReais, restante,
} from "../components/ui";

const FILTROS: { valor: StatusPedido | "TODOS"; rotulo: string }[] = [
  { valor: "TODOS", rotulo: "Todos" },
  { valor: "CONCLUIDO", rotulo: "Concluídos" },
  { valor: "AGUARDANDO_PAGAMENTO", rotulo: "Em andamento" },
  { valor: "CANCELADO", rotulo: "Cancelados" },
  { valor: "RECUSADO", rotulo: "Recusados" },
  { valor: "EXPIRADO", rotulo: "Expirados" },
];

/**
 * Pedidos e pagamentos.
 *
 * O mesmo componente serve aos três perfis, porque o backend já devolve o
 * recorte certo: participante vê os próprios; organizador, as vendas dos seus
 * eventos; ADM, tudo.
 */
export function Pedidos({ ctx }: { ctx: Ctx }) {
  const [filtro, setFiltro] = useState<StatusPedido | "TODOS">("TODOS");

  const { dados, erro, carregando, recarregar } = useCarregar<Pedido[]>(
    () => api("GET", `ingressos/pedidos?limite=100${filtro === "TODOS" ? "" : `&status=${filtro}`}`),
    [filtro],
    6000
  );

  const pedidos = dados ?? [];
  const organizador = ctx.eu.papel === "ORGANIZADOR";

  const receita = pedidos
    .filter((p) => p.status === "CONCLUIDO")
    .reduce((t, p) => t + p.totalCentavos, 0);

  return (
    <>
      <PaginaTopo
        titulo={organizador ? "Vendas" : "Pedidos"}
        descricao={
          organizador
            ? "As vendas dos seus eventos, com a situação de cada pedido."
            : ctx.eu.papel === "ADM"
            ? "Todos os pedidos da plataforma, com histórico e pagamento."
            : "Seus pedidos, com a situação e o histórico de cada um."
        }
      />

      <div className="filtros">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            className={`aba-filtro ${filtro === f.valor ? "ativo" : ""}`}
            onClick={() => setFiltro(f.valor)}
          >
            {f.rotulo}
          </button>
        ))}
        {pedidos.length > 0 && (
          <span className="ter" style={{ marginLeft: "auto" }}>
            {organizador || ctx.eu.papel === "ADM" ? "Receita confirmada: " : "Total gasto: "}
            <b>{emReais(receita)}</b>
          </span>
        )}
      </div>

      <Alerta texto={erro} />

      {carregando && pedidos.length === 0 ? (
        <Carregando linhas={3} />
      ) : pedidos.length === 0 ? (
        <Vazio
          icone={Receipt}
          titulo={filtro === "TODOS" ? "Nenhum pedido ainda" : "Nenhum pedido nesta situação"}
          texto={
            filtro !== "TODOS"
              ? "Mude o filtro para ver os outros pedidos."
              : organizador
              ? "Quando alguém comprar ingresso dos seus eventos, a venda aparece aqui."
              : "Seus pedidos aparecem aqui assim que você comprar um ingresso."
          }
        />
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {pedidos.map((p) => (
            <CartaoPedido key={p.id} p={p} ctx={ctx} aoMudar={recarregar} />
          ))}
        </div>
      )}
    </>
  );
}

function CartaoPedido(
  { p, ctx, aoMudar }: { p: Pedido; ctx: Ctx; aoMudar: () => Promise<void> }
) {
  const acao = useAcao();
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const meu = p.compradorId === ctx.eu.id;
  const podeCancelar = p.podeCancelar && (meu || ctx.eu.papel === "ADM");
  const falta = p.emAndamento ? restante(p.expiraEm) : null;

  return (
    <article className="cartao">
      <div className="lin" style={{ gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="cresce" style={{ minWidth: 0 }}>
          <div className="lin" style={{ gap: 8 }}>
            <b>{p.eventoNome ?? "Evento"}</b>
            <Selo status={p.status} />
          </div>
          <div className="meta">
            {p.itens.reduce((t, i) => t + i.quantidade, 0)} ingresso(s) ·{" "}
            {ROTULO_MEIO[p.meio] ?? p.meio} · pedido {desde(p.criadoEm)}
          </div>
          {ctx.eu.papel !== "PARTICIPANTE" && (
            <div className="meta">Comprador: {ctx.nomeUsuario(p.compradorId)}</div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <b style={{ fontSize: "1.1rem" }}>{p.total}</b>
          {falta && <div className="ter" style={{ fontSize: ".72rem" }}>expira em {falta}</div>}
        </div>
      </div>

      {p.motivo && p.status !== "CONCLUIDO" && (
        <p className="sec mt" style={{ fontSize: ".82rem" }}>{p.motivo}</p>
      )}

      <Alerta texto={acao.erro} />

      <div className="lin mt" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="b-fantasma b-pequeno" onClick={() => setAberto(!aberto)}>
          {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {aberto ? "Ocultar detalhes" : "Ver detalhes e histórico"}
        </button>
        <span className="espaco" />
        {podeCancelar && (
          <button className="b-perigo b-pequeno" onClick={() => setConfirmando(true)} disabled={acao.ocupado}>
            <Undo2 size={14} />Cancelar pedido
          </button>
        )}
      </div>

      {aberto && <Detalhes p={p} ctx={ctx} />}

      {confirmando && (
        <Confirmacao
          titulo="Cancelar pedido"
          texto={
            p.status === "CONCLUIDO"
              ? "Os ingressos deixam de valer, os lugares voltam à venda e o valor é estornado."
              : "O pedido é encerrado e os lugares reservados voltam ao estoque."
          }
          rotuloConfirmar="Cancelar pedido"
          perigo
          ocupado={acao.ocupado}
          aoCancelar={() => setConfirmando(false)}
          aoConfirmar={async () => {
            const ok = await acao.executar(async () => {
              await api("POST", `ingressos/pedidos/${p.id}/cancelar`, {
                motivo: ctx.eu.papel === "ADM" && !meu
                  ? "cancelado pelo administrador"
                  : "cancelado pelo comprador",
              });
              await aoMudar();
              ctx.avisarMudanca();
            });
            if (ok) setConfirmando(false);
          }}
        />
      )}
    </article>
  );
}

function Detalhes({ p, ctx }: { p: Pedido; ctx: Ctx }) {
  const { dados: historico } = useCarregar<LinhaHistorico[]>(
    () => api("GET", `ingressos/pedidos/${p.id}/historico`), [p.id]
  );

  // Pagamento pode estar fora do ar: a falha não derruba o resto da tela.
  const { dados: pagamento, erro: erroPgto } = useCarregar<Transacao | null>(
    () => api<Transacao>("GET", `pagamento/pedido/${p.id}`).catch(() => null), [p.id]
  );

  return (
    <div className="detalhe-pedido mt">
      <div className="grade g-2">
        <div>
          <h4 className="mb">Itens</h4>
          <div className="lista">
            {p.itens.map((i, idx) => (
              <div key={idx} className="lista-item">
                <div className="cresce">
                  <div className="nome">{i.setorNome ?? "Setor"} · {i.loteNome ?? "Lote"}</div>
                  <div className="meta">{i.quantidade} × {i.precoUnitario}</div>
                </div>
                <b>{emReais(i.precoUnitarioCentavos * i.quantidade)}</b>
              </div>
            ))}
          </div>

          {p.ingressos.length > 0 && (
            <>
              <h4 className="mb mt">Ingressos</h4>
              <div className="col" style={{ gap: 5 }}>
                {p.ingressos.map((i) => (
                  <div key={i.id} className="codigo-linha">
                    <code>{i.codigo}</code>
                    <Selo status={i.status} />
                  </div>
                ))}
              </div>
            </>
          )}

          <h4 className="mb mt">Pagamento</h4>
          {erroPgto ? (
            <p className="sec" style={{ fontSize: ".82rem" }}>
              Serviço de pagamento indisponível. O restante do pedido continua visível.
            </p>
          ) : !pagamento ? (
            <p className="sec" style={{ fontSize: ".82rem" }}>
              Nenhuma cobrança registrada para este pedido.
            </p>
          ) : (
            <div className="lista">
              <div className="lista-item">
                <span className="cresce sec">Situação</span>
                <Selo status={pagamento.status} />
              </div>
              <div className="lista-item">
                <span className="cresce sec">Meio</span>
                <b>{pagamento.meioRotulo}</b>
              </div>
              <div className="lista-item">
                <span className="cresce sec">Referência</span>
                <code style={{ fontSize: ".78rem" }}>{pagamento.referenciaPagamento}</code>
              </div>
              {pagamento.autorizacao && (
                <div className="lista-item">
                  <span className="cresce sec">Autorização</span>
                  <code style={{ fontSize: ".78rem" }}>{pagamento.autorizacao}</code>
                </div>
              )}
              {pagamento.estornadoEm && (
                <div className="lista-item">
                  <span className="cresce sec">Estornado em</span>
                  <b>{dataHora(pagamento.estornadoEm)}</b>
                </div>
              )}
              {pagamento.motivo && (
                <p className="sec mt" style={{ fontSize: ".8rem" }}>{pagamento.motivo}</p>
              )}
            </div>
          )}
        </div>

        <div>
          <h4 className="mb">Histórico</h4>
          {!historico ? (
            <p className="sec">Carregando…</p>
          ) : (
            <ol className="linha-tempo">
              {historico.map((h) => (
                <li key={h.id}>
                  <div className="lin" style={{ gap: 8 }}>
                    <b>{ROTULO_COMANDO[h.comando] ?? h.comando}</b>
                    <span className="espaco" />
                    <span className="tempo">{dataHora(h.executadoEm)}</span>
                  </div>
                  <div className="meta">
                    {h.autorId ? `por ${ctx.nomeUsuario(h.autorId)}` : "pelo sistema"}
                    {" · "}situação: {h.statusApos}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="sec mt" style={{ fontSize: ".74rem" }}>
            Toda ação sobre o pedido passa por um comando e deixa registro.
          </p>
        </div>
      </div>
    </div>
  );
}
