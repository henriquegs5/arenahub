import { useState } from "react";
import { CalendarDays, Check, Copy, MapPin, Ticket } from "lucide-react";
import { api } from "../api";
import { useAcao, useCarregar } from "../hooks";
import { Ctx, Ingresso, StatusIngresso } from "../types";
import {
  Alerta, Carregando, Confirmacao, PaginaTopo, ROTULO_POLITICA, Selo, Vazio,
  dataHora,
} from "../components/ui";

const ABAS: { valor: StatusIngresso | "TODOS"; rotulo: string }[] = [
  { valor: "EMITIDO", rotulo: "Válidos" },
  { valor: "UTILIZADO", rotulo: "Utilizados" },
  { valor: "TODOS", rotulo: "Todos" },
];

export function MeusIngressos({ ctx }: { ctx: Ctx }) {
  const [aba, setAba] = useState<StatusIngresso | "TODOS">("EMITIDO");

  const { dados, erro, carregando, recarregar } = useCarregar<Ingresso[]>(
    () => api("GET", `ingressos?limite=100${aba === "TODOS" ? "" : `&status=${aba}`}`),
    [aba],
    8000
  );

  const ingressos = dados ?? [];

  return (
    <>
      <PaginaTopo
        titulo={ctx.eu.papel === "ADM" ? "Ingressos" : "Meus ingressos"}
        descricao={
          ctx.eu.papel === "ADM"
            ? "Todos os ingressos emitidos na plataforma."
            : "Apresente o código na entrada do evento."
        }
      />

      <div className="filtros">
        {ABAS.map((a) => (
          <button
            key={a.valor}
            className={`aba-filtro ${aba === a.valor ? "ativo" : ""}`}
            onClick={() => setAba(a.valor)}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <Alerta texto={erro} />

      {carregando && ingressos.length === 0 ? (
        <Carregando linhas={2} />
      ) : ingressos.length === 0 ? (
        <Vazio
          icone={Ticket}
          titulo={aba === "EMITIDO" ? "Nenhum ingresso válido" : "Nenhum ingresso nesta seleção"}
          texto={
            aba === "EMITIDO"
              ? "Quando você comprar um ingresso, ele aparece aqui com o código de entrada."
              : "Mude o filtro para ver os outros ingressos."
          }
        />
      ) : (
        <div className="grade g-cartoes">
          {ingressos.map((i) => (
            <CartaoIngresso key={i.id} i={i} ctx={ctx} aoMudar={recarregar} />
          ))}
        </div>
      )}
    </>
  );
}

function CartaoIngresso(
  { i, ctx, aoMudar }: { i: Ingresso; ctx: Ctx; aoMudar: () => Promise<void> }
) {
  const acao = useAcao();
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const meu = i.titularId === ctx.eu.id;
  const podeCancelar = i.status === "EMITIDO" && (meu || ctx.eu.papel === "ADM");

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(i.codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sem permissão de área de transferência: o código está à vista */ }
  };

  return (
    <article className={`cartao bilhete ${i.status !== "EMITIDO" ? "inativo" : ""}`}>
      <div className="lin" style={{ gap: 8, alignItems: "flex-start" }}>
        <div className="cresce" style={{ minWidth: 0 }}>
          <h3 className="titulo-cartao">{i.eventoNome ?? "Evento"}</h3>
          <div className="meta lin" style={{ gap: 6 }}>
            <CalendarDays size={13} />{dataHora(i.eventoDataHora)}
          </div>
          {i.eventoLocal && (
            <div className="meta lin" style={{ gap: 6 }}>
              <MapPin size={13} /><span className="corta">{i.eventoLocal}</span>
            </div>
          )}
        </div>
        <Selo status={i.status} />
      </div>

      <div className="sep" />

      <div className="lin" style={{ gap: 10, flexWrap: "wrap" }}>
        <div className="cresce">
          <div className="ter" style={{ fontSize: ".72rem" }}>Setor e lote</div>
          <b>{i.setorNome ?? "—"}</b>
          <span className="ter"> · {i.loteNome ?? "—"}</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="ter" style={{ fontSize: ".72rem" }}>
            {ROTULO_POLITICA[i.politica] ?? i.politica}
          </div>
          <b>{i.preco}</b>
        </div>
      </div>

      {/*
        O código É o ingresso digital: é ele que a portaria lê e valida. Fica em
        destaque, com botão de copiar, em vez de uma imagem decorativa.
      */}
      <div className="codigo-ingresso mt">
        <span className="ter" style={{ fontSize: ".7rem" }}>Código de entrada</span>
        <div className="lin" style={{ gap: 8 }}>
          <code className="cresce">{i.codigo}</code>
          <button className="b-fantasma b-pequeno b-icone" onClick={copiar}
            aria-label="Copiar código" title="Copiar">
            {copiado ? <Check size={14} color="var(--verde)" /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      {i.status === "UTILIZADO" && i.validadoEm && (
        <p className="sec mt" style={{ fontSize: ".76rem" }}>
          Entrada validada em {dataHora(i.validadoEm)}.
        </p>
      )}
      {i.status === "INVALIDADO" && (
        <p className="sec mt" style={{ fontSize: ".76rem", color: "var(--vermelho)" }}>
          Invalidado porque o evento foi cancelado. O estorno foi processado.
        </p>
      )}
      {i.status === "CANCELADO" && (
        <p className="sec mt" style={{ fontSize: ".76rem" }}>Ingresso cancelado.</p>
      )}

      <Alerta texto={acao.erro} />

      {podeCancelar && (
        <button className="b-perigo b-bloco mt b-pequeno" onClick={() => setConfirmando(true)}
          disabled={acao.ocupado}>
          Cancelar ingresso
        </button>
      )}

      {confirmando && (
        <Confirmacao
          titulo="Cancelar ingresso"
          texto="O ingresso deixa de valer na entrada e o lugar volta para a venda. Se este for o último ingresso do pedido, o pedido inteiro é cancelado e estornado."
          rotuloConfirmar="Cancelar ingresso"
          perigo
          ocupado={acao.ocupado}
          aoCancelar={() => setConfirmando(false)}
          aoConfirmar={async () => {
            const ok = await acao.executar(async () => {
              await api("POST", `ingressos/${i.id}/cancelar`);
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
