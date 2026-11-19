import { useState } from "react";
import { Inbox, RefreshCw, ServerCog, Trash2 } from "lucide-react";
import { api, statusServicos } from "../api";
import { useAcao, useCarregar } from "../hooks";
import { RespostaDLQ, StatusServico } from "../types";
import { Alerta, Confirmacao, Girando, PaginaTopo, dataHora } from "../components/ui";

/** Serviços com fila própria e, portanto, com dead letter própria. */
const SERVICOS = [
  { id: "eventos", nome: "Eventos", caminho: "eventos" },
  { id: "ingressos", nome: "Ingressos", caminho: "ingressos" },
  { id: "pagamento", nome: "Pagamento", caminho: "pagamento" },
  { id: "notificacoes", nome: "Notificações", caminho: "notificacoes" },
  { id: "gateway", nome: "Gateway (contas)", caminho: "auth" },
] as const;

/**
 * Painel de infraestrutura (somente ADM).
 *
 * Reúne o que a demonstração de tolerância a falhas precisa mostrar: saúde dos
 * serviços, estado dos disjuntores e as mensagens paradas na dead letter.
 */
export function Sistema() {
  const { dados: saude } = useCarregar<Record<string, StatusServico>>(
    () => statusServicos(), [], 3000
  );

  return (
    <>
      <PaginaTopo
        titulo="Sistema"
        descricao="Saúde dos microsserviços, disjuntores e mensagens que falharam de forma permanente."
      />

      <section className="cartao mb">
        <div className="cartao-cab">
          <h3>Microsserviços</h3>
          <span className="ter">Atualiza a cada 3 segundos</span>
        </div>

        <div className="grade g-stats">
          {SERVICOS.filter((s) => s.id !== "gateway").map((s) => {
            const st = saude?.[s.id];
            const noAr = st?.servico === "no ar";
            return (
              <div key={s.id} className="stat">
                <span className={`icone ${noAr ? "verde" : "vermelho"}`}>
                  <ServerCog size={18} />
                </span>
                <div>
                  <div className="valor" style={{ fontSize: "1rem" }}>{s.nome}</div>
                  <div className="rotulo">
                    {st ? st.servico : "sem resposta"}
                    {st && st.circuito !== "FECHADO" && (
                      <span style={{ color: "var(--ambar)" }}> · circuito {st.circuito.toLowerCase()}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="sec mt" style={{ fontSize: ".78rem" }}>
          Cada serviço tem disjuntor próprio no Gateway: com um fora do ar, o circuito
          abre e o restante do sistema continua respondendo.
        </p>
      </section>

      <h2 className="mb">Mensagens com falha permanente</h2>
      <p className="sec mb">
        Uma mensagem que falha repetidamente no consumidor não é descartada: vai para a
        fila de descarte do serviço. Daqui dá para devolvê-la à fila ou descartá-la de vez.
      </p>

      <div className="col" style={{ gap: 12 }}>
        {SERVICOS.map((s) => <FilaDescarte key={s.id} nome={s.nome} caminho={s.caminho} />)}
      </div>
    </>
  );
}

function FilaDescarte({ nome, caminho }: { nome: string; caminho: string }) {
  const acao = useAcao();
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const { dados, erro, recarregar } = useCarregar<RespostaDLQ>(
    () => api("GET", `${caminho}/dlq`), [caminho], 10000
  );

  const total = dados?.total ?? 0;
  const vazia = total === 0;

  return (
    <section className="cartao">
      <div className="cartao-cab">
        <span className={`icone-fila ${vazia ? "" : "alerta"}`}><Inbox size={16} /></span>
        <h3>{nome}</h3>
        <span className={vazia ? "ter" : "selo vermelho"}>
          {vazia ? "Nenhuma mensagem parada" : `${total} parada(s)`}
        </span>
        {!vazia && (
          <>
            <button
              className="b-secundario b-pequeno"
              disabled={acao.ocupado}
              onClick={() =>
                acao.executar(async () => {
                  const r = await api<{ reprocessadas: number }>("POST", `${caminho}/dlq/reprocessar`);
                  await recarregar();
                  return r;
                }, "Mensagens devolvidas à fila do serviço.")
              }
            >
              {acao.ocupado ? <Girando /> : <RefreshCw size={14} />}Reprocessar
            </button>
            <button className="b-perigo b-pequeno" onClick={() => setConfirmando(true)} disabled={acao.ocupado}>
              <Trash2 size={14} />Descartar
            </button>
          </>
        )}
      </div>

      <Alerta texto={erro} />
      <Alerta texto={acao.erro} />
      <Alerta texto={acao.sucesso} tipo="ok" />

      {!vazia && (
        <>
          <button className="b-fantasma b-pequeno" onClick={() => setAberto(!aberto)}>
            {aberto ? "Ocultar mensagens" : "Ver mensagens"}
          </button>

          {aberto && (
            <div className="col mt" style={{ gap: 8 }}>
              {(dados?.mensagens ?? []).map((m) => (
                <div key={m.eventId} className="mensagem-dlq">
                  <div className="lin" style={{ gap: 8 }}>
                    <b>{m.type}.v{m.version}</b>
                    <span className="espaco" />
                    <span className="tempo">{dataHora(m.occurredAt)}</span>
                  </div>
                  <div className="meta">
                    de {m.producer} · correlação {m.correlationId}
                  </div>
                  <pre className="json-dlq">{JSON.stringify(m.payload, null, 2)}</pre>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {confirmando && (
        <Confirmacao
          titulo={`Descartar mensagens de ${nome}`}
          texto={`As ${total} mensagem(ns) paradas são apagadas de vez. Só faça isso depois de analisar o que falhou.`}
          rotuloConfirmar="Descartar"
          perigo
          ocupado={acao.ocupado}
          aoCancelar={() => setConfirmando(false)}
          aoConfirmar={async () => {
            const ok = await acao.executar(async () => {
              await api("DELETE", `${caminho}/dlq`);
              await recarregar();
            }, "Mensagens descartadas.");
            if (ok) setConfirmando(false);
          }}
        />
      )}
    </section>
  );
}
