import { useRef, useState } from "react";
import { CheckCircle2, QrCode, ScanLine, XCircle } from "lucide-react";
import { api } from "../api";
import { useAcao } from "../hooks";
import { Ctx, ResultadoValidacao } from "../types";
import { Alerta, Girando, PaginaTopo, dataHora } from "../components/ui";

/** Uma leitura já feita, para o organizador conferir o que passou. */
interface Leitura {
  codigo: string;
  aprovado: boolean;
  motivo: string | null;
  evento: string | null;
  setor: string | null;
  quando: string;
}

/**
 * Validação na entrada (check-in).
 *
 * A API responde 200 mesmo quando RECUSA, com `aprovado: false` e o motivo:
 * a portaria precisa ler o motivo na tela, não um erro genérico.
 */
export function Validar({ ctx }: { ctx: Ctx }) {
  const acao = useAcao();
  const [codigo, setCodigo] = useState("");
  const [ultima, setUltima] = useState<ResultadoValidacao | null>(null);
  const [historico, setHistorico] = useState<Leitura[]>([]);
  const campo = useRef<HTMLInputElement>(null);

  const validar = async () => {
    const cod = codigo.trim().toUpperCase();
    if (cod.length < 4) return;

    await acao.executar(async () => {
      const r = await api<ResultadoValidacao>("POST", "ingressos/validar", { codigo: cod });
      setUltima(r);
      setHistorico((h) => [
        {
          codigo: cod,
          aprovado: r.aprovado,
          motivo: r.motivo,
          evento: r.ingresso?.eventoNome ?? null,
          setor: r.ingresso?.setorNome ?? null,
          quando: new Date().toISOString(),
        },
        ...h,
      ].slice(0, 12));
      setCodigo("");
      // Devolve o foco para a próxima leitura, sem o operador precisar clicar.
      campo.current?.focus();
    });
  };

  const aprovados = historico.filter((h) => h.aprovado).length;

  return (
    <>
      <PaginaTopo
        titulo="Validação na entrada"
        descricao={
          ctx.eu.papel === "ADM"
            ? "Leia o código do ingresso. Como administrador, você valida qualquer evento."
            : "Leia o código do ingresso. Você valida os ingressos dos seus eventos."
        }
      />

      <div className="grade g-2">
        <div className="col" style={{ gap: 14 }}>
          <section className="cartao">
            <div className="cartao-cab"><h3>Ler ingresso</h3></div>

            <form onSubmit={(e) => { e.preventDefault(); void validar(); }}>
              <div className="campo">
                <label htmlFor="codigo">Código do ingresso</label>
                <div className="lin" style={{ gap: 8 }}>
                  <input
                    id="codigo"
                    ref={campo}
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                    placeholder="ARENA-XXXX-XXXX-XXXX"
                    autoComplete="off"
                    autoFocus
                    spellCheck={false}
                    className="codigo-entrada cresce"
                  />
                  <button type="submit" className="b-primario" disabled={acao.ocupado || codigo.trim().length < 4}>
                    {acao.ocupado ? <Girando /> : <ScanLine size={16} />}Validar
                  </button>
                </div>
                <small className="ajuda">
                  Digite ou cole o código. O campo aceita leitor de código de barras.
                </small>
              </div>
            </form>

            <Alerta texto={acao.erro} />

            {ultima && (
              <div className={`resultado-checkin ${ultima.aprovado ? "ok" : "recusado"} mt`} role="status">
                <div className="lin" style={{ gap: 10 }}>
                  {ultima.aprovado ? <CheckCircle2 size={26} /> : <XCircle size={26} />}
                  <div className="cresce">
                    <b style={{ fontSize: "1.05rem" }}>
                      {ultima.aprovado ? "Entrada liberada" : "Entrada recusada"}
                    </b>
                    {!ultima.aprovado && ultima.motivo && (
                      <div style={{ fontSize: ".88rem", marginTop: 2 }}>{ultima.motivo}</div>
                    )}
                    {ultima.aprovado && ultima.ingresso && (
                      <div style={{ fontSize: ".88rem", marginTop: 2 }}>
                        {ultima.ingresso.eventoNome} · {ultima.ingresso.setorNome} · {ultima.ingresso.loteNome}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="cartao">
          <div className="cartao-cab">
            <h3>Leituras desta sessão</h3>
            {historico.length > 0 && (
              <span className="ter">{aprovados} de {historico.length} liberadas</span>
            )}
          </div>

          {historico.length === 0 ? (
            <p className="sec">
              <QrCode size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              As leituras aparecem aqui conforme você valida.
            </p>
          ) : (
            <div className="lista">
              {historico.map((h, i) => (
                <div key={`${h.codigo}-${i}`} className="lista-item">
                  <span className={`ponto ${h.aprovado ? "ok" : "erro"}`} />
                  <div className="cresce" style={{ minWidth: 0 }}>
                    <code style={{ fontSize: ".78rem" }}>{h.codigo}</code>
                    <div className="meta">
                      {h.aprovado ? (h.evento ?? "liberada") : h.motivo}
                    </div>
                  </div>
                  <span className="tempo">{dataHora(h.quando).split(" ")[1]}</span>
                </div>
              ))}
            </div>
          )}

          <p className="sec mt" style={{ fontSize: ".74rem" }}>
            A lista vale só para esta sessão da tela. O registro permanente fica no
            histórico de cada pedido.
          </p>
        </section>
      </div>
    </>
  );
}
