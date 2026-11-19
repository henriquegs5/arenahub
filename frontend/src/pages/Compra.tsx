import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, Minus, Plus, Ticket, XCircle } from "lucide-react";
import { api } from "../api";
import { useAcao } from "../hooks";
import {
  Ctx, EventoDetalhe, MeiosPagamento, MeioPagamento, Pedido, PoliticaPreco,
} from "../types";
import {
  Alerta, Campo, Girando, ROTULO_POLITICA, Selo, emReais, restante,
} from "../components/ui";

/** Um item escolhido: lote + quantidade + política de preço. */
interface Escolha { loteId: string; quantidade: number; politica: PoliticaPreco }

/**
 * Painel de compra.
 *
 * A compra responde HTTP 202: o pedido nasce PENDENTE e a Saga resolve por
 * eventos. Por isso, depois de confirmar, a tela acompanha o pedido mudando de
 * estado em vez de fingir que terminou.
 */
export function Compra(
  { ctx, evento, aoComprar }:
  { ctx: Ctx; evento: EventoDetalhe; aoComprar: () => Promise<void> }
) {
  const acao = useAcao();
  const [escolhas, setEscolhas] = useState<Escolha[]>([]);
  const [meio, setMeio] = useState<MeioPagamento>("PIX");
  const [meios, setMeios] = useState<MeiosPagamento | null>(null);
  const [pedidoId, setPedidoId] = useState<string | null>(null);

  // null com pagamentoFora=false = ainda carregando; pagamentoFora=true = serviço indisponível.
  const [pagamentoFora, setPagamentoFora] = useState(false);

  useEffect(() => {
    let vivo = true;
    const carregar = () =>
      api<MeiosPagamento>("GET", "pagamento/meta/meios")
        .then((m) => { if (vivo) { setMeios(m); setPagamentoFora(false); } })
        .catch(() => { if (vivo) { setMeios(null); setPagamentoFora(true); } });
    carregar();
    // Enquanto o Pagamento estiver fora, tenta de novo: a tela se recupera sozinha.
    const t = setInterval(() => { if (vivo) carregar(); }, 8000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const lotes = useMemo(
    () => evento.setores.flatMap((s) => s.lotes.map((l) => ({ ...l, setorNome: s.nome }))),
    [evento]
  );
  const disponiveis = lotes.filter((l) => l.vigente && l.disponiveis > 0);

  const ajustar = (loteId: string, delta: number) => {
    setEscolhas((atual) => {
      const lote = lotes.find((l) => l.id === loteId)!;
      const achou = atual.find((e) => e.loteId === loteId);
      const nova = Math.min(Math.max((achou?.quantidade ?? 0) + delta, 0), Math.min(lote.disponiveis, 20));
      if (nova === 0) return atual.filter((e) => e.loteId !== loteId);
      if (!achou) return [...atual, { loteId, quantidade: nova, politica: lote.politicaPadrao }];
      return atual.map((e) => (e.loteId === loteId ? { ...e, quantidade: nova } : e));
    });
  };

  const trocarPolitica = (loteId: string, politica: PoliticaPreco) =>
    setEscolhas((atual) => atual.map((e) => (e.loteId === loteId ? { ...e, politica } : e)));

  /**
   * O total é calculado AQUI apenas para a tela; quem decide o preço de verdade
   * é o serviço de Eventos, na reserva. Os dois usam a mesma regra (Strategy).
   */
  const total = escolhas.reduce((t, e) => {
    const lote = lotes.find((l) => l.id === e.loteId);
    if (!lote) return t;
    const unit =
      e.politica === "CORTESIA" ? 0
      : e.politica === "MEIA" ? Math.round(lote.precoCentavos / 2)
      : e.politica === "PROMOCIONAL"
        ? Math.round((lote.precoCentavos * (100 - lote.descontoPercentual)) / 100)
        : lote.precoCentavos;
    return t + unit * e.quantidade;
  }, 0);

  const quantidade = escolhas.reduce((t, e) => t + e.quantidade, 0);

  if (pedidoId) {
    return (
      <AcompanharPedido
        pedidoId={pedidoId}
        aoFechar={async () => { setPedidoId(null); setEscolhas([]); await aoComprar(); }}
      />
    );
  }

  const comprar = () =>
    acao.executar(async () => {
      const pedido = await api<Pedido>("POST", "ingressos/pedidos", {
        eventoId: evento.id,
        meio,
        // Referência OPACA ao meio de pagamento. O sistema nunca recebe cartão.
        referenciaPagamento: `tok_${meio.toLowerCase()}_${Date.now().toString(36)}`,
        itens: escolhas,
      });
      setPedidoId(pedido.id);
    });

  return (
    <section className="cartao">
      <div className="cartao-cab"><h3>Comprar ingresso</h3></div>

      {disponiveis.length === 0 ? (
        <p className="sec">Nenhum lote está vendendo agora.</p>
      ) : (
        <>
          <div className="col" style={{ gap: 10 }}>
            {disponiveis.map((l) => {
              const escolha = escolhas.find((e) => e.loteId === l.id);
              return (
                <div key={l.id} className="linha-escolha">
                  <div className="cresce" style={{ minWidth: 0 }}>
                    <b>{l.nome}</b>
                    <div className="meta">{l.setorNome} · {l.disponiveis} disponíveis</div>
                    {escolha && (
                      <select
                        className="mini mt"
                        value={escolha.politica}
                        onChange={(e) => trocarPolitica(l.id, e.target.value as PoliticaPreco)}
                        aria-label={`Política de preço do lote ${l.nome}`}
                      >
                        {(["INTEIRA", "MEIA", "PROMOCIONAL", "CORTESIA"] as PoliticaPreco[]).map((p) => (
                          <option key={p} value={p}>{ROTULO_POLITICA[p]}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="col" style={{ alignItems: "flex-end", gap: 6 }}>
                    <b>{l.precoFormatado}</b>
                    <div className="contador">
                      <button
                        className="b-fantasma b-pequeno b-icone"
                        onClick={() => ajustar(l.id, -1)}
                        disabled={!escolha}
                        aria-label={`Menos um de ${l.nome}`}
                      >
                        <Minus size={13} />
                      </button>
                      <span aria-live="polite">{escolha?.quantidade ?? 0}</span>
                      <button
                        className="b-fantasma b-pequeno b-icone"
                        onClick={() => ajustar(l.id, 1)}
                        disabled={(escolha?.quantidade ?? 0) >= Math.min(l.disponiveis, 20)}
                        aria-label={`Mais um de ${l.nome}`}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sep" />

          <Campo
            id="meio-pgto"
            rotulo="Meio de pagamento"
            ajuda={
              meio === "CARTAO_RECUSADO"
                ? "Este meio recusa sempre: serve para demonstrar a compensação da Saga."
                : "O sistema trabalha com uma referência (token) do meio de pagamento, nunca com o número do cartão."
            }
          >
            <select
              id="meio-pgto"
              value={meio}
              disabled={!meios}
              onChange={(e) => setMeio(e.target.value as MeioPagamento)}
            >
              {(meios?.meios ?? []).map((m) => (
                <option key={m.valor} value={m.valor}>{m.rotulo}</option>
              ))}
              {!meios && <option value="">{pagamentoFora ? "Indisponível" : "Carregando..."}</option>}
            </select>
          </Campo>

          {pagamentoFora && (
            <Alerta
              texto="O serviço de pagamento está indisponível no momento, então a compra não pode ser feita agora. O catálogo e os seus ingressos continuam funcionando. Esta tela tenta de novo sozinha e libera a compra quando o pagamento voltar."
            />
          )}

          <div className="lin mt" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="sec">{quantidade} ingresso(s)</span>
            <div style={{ textAlign: "right" }}>
              <div className="ter" style={{ fontSize: ".72rem" }}>Total</div>
              <b style={{ fontSize: "1.3rem" }}>{emReais(total)}</b>
            </div>
          </div>

          {total % 100 === 66 && total > 0 && (
            <Alerta
              tipo="info"
              texto="Este total termina em 66 centavos e será recusado pelo provedor: é um dos gatilhos de recusa da demonstração."
            />
          )}

          <Alerta texto={acao.erro} />

          <button
            className="b-primario b-bloco mt"
            onClick={comprar}
            disabled={acao.ocupado || quantidade === 0 || !meios}
          >
            {acao.ocupado ? <Girando /> : <Ticket size={16} />}
            Comprar {quantidade > 0 && `· ${emReais(total)}`}
          </button>

          <p className="sec mt" style={{ fontSize: ".74rem" }}>
            O pedido é processado em segundo plano: os lugares são reservados e o
            pagamento, cobrado. Você acompanha aqui mesmo.
          </p>
        </>
      )}
    </section>
  );
}

// ============================================================ acompanhamento

/** Passos da Saga, na ordem, para a tela mostrar onde o pedido está. */
const PASSOS = [
  { status: "PENDENTE", texto: "Pedido recebido" },
  { status: "RESERVADO", texto: "Lugares reservados" },
  { status: "AGUARDANDO_PAGAMENTO", texto: "Cobrando o pagamento" },
  { status: "CONCLUIDO", texto: "Ingressos emitidos" },
];

const FINAIS = ["CONCLUIDO", "RECUSADO", "EXPIRADO", "CANCELADO"];

/**
 * Acompanha o pedido enquanto a Saga roda. Consulta até o pedido chegar a um
 * estado final — e aí para, em vez de ficar batendo no servidor para sempre.
 */
function AcompanharPedido({ pedidoId, aoFechar }: { pedidoId: string; aoFechar: () => void }) {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    let id: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const p = await api<Pedido>("GET", `ingressos/pedidos/${pedidoId}`);
        if (!ativo) return;
        setPedido(p);
        setErro(null);
        if (FINAIS.includes(p.status) && id) { clearInterval(id); id = null; }
      } catch (e) {
        if (ativo) setErro((e as Error).message);
      }
    };

    tick();
    id = setInterval(tick, 1200);
    return () => { ativo = false; if (id) clearInterval(id); };
  }, [pedidoId]);

  const status = pedido?.status ?? "PENDENTE";
  const concluido = status === "CONCLUIDO";
  const falhou = ["RECUSADO", "EXPIRADO", "CANCELADO"].includes(status);
  const passoAtual = PASSOS.findIndex((p) => p.status === status);

  return (
    <section className="cartao">
      <div className="cartao-cab">
        <h3>{concluido ? "Compra confirmada" : falhou ? "Compra não concluída" : "Processando a compra"}</h3>
        <Selo status={status} />
      </div>

      <Alerta texto={erro} />

      {!falhou && (
        <ol className="passos">
          {PASSOS.map((p, i) => {
            const feito = concluido || (passoAtual >= 0 && i < passoAtual);
            const agora = !concluido && i === passoAtual;
            return (
              <li key={p.status} className={feito ? "feito" : agora ? "agora" : ""}>
                <span className="marca-passo">
                  {feito ? <CheckCircle2 size={15} /> : agora ? <Girando /> : <Clock size={15} />}
                </span>
                {p.texto}
              </li>
            );
          })}
        </ol>
      )}

      {falhou && (
        <div className="col" style={{ gap: 10, alignItems: "flex-start" }}>
          <div className="lin" style={{ gap: 8, color: "var(--vermelho)" }}>
            <XCircle size={18} />
            <b>
              {status === "RECUSADO" ? "O pagamento não foi autorizado"
                : status === "EXPIRADO" ? "O pedido expirou"
                : "O pedido foi cancelado"}
            </b>
          </div>
          {pedido?.motivo && <p className="sec">{pedido.motivo}</p>}
          <p className="sec" style={{ fontSize: ".8rem" }}>
            Os lugares foram devolvidos ao estoque. Você pode tentar de novo.
          </p>
        </div>
      )}

      {concluido && pedido && (
        <div className="col mt" style={{ gap: 8 }}>
          <p className="sec">
            {pedido.ingressos.length} ingresso(s) emitido(s) · {pedido.total}
          </p>
          <div className="col" style={{ gap: 6 }}>
            {pedido.ingressos.map((i) => (
              <div key={i.id} className="codigo-linha">
                <code>{i.codigo}</code>
                <span className="ter">{i.setorNome} · {i.loteNome}</span>
              </div>
            ))}
          </div>
          <p className="sec" style={{ fontSize: ".78rem" }}>
            Os códigos também ficam em <b>Meus ingressos</b>.
          </p>
        </div>
      )}

      {!concluido && !falhou && pedido && restante(pedido.expiraEm) && (
        <p className="sec mt" style={{ fontSize: ".76rem" }}>
          Se a cobrança não for concluída em {restante(pedido.expiraEm)}, o pedido expira e
          os lugares voltam ao estoque.
        </p>
      )}

      <button className="b-secundario b-bloco mt" onClick={aoFechar}>
        {concluido || falhou ? "Voltar ao evento" : "Acompanhar depois"}
      </button>
    </section>
  );
}
