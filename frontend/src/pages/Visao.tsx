import { useState } from "react";
import { Bell, Ticket, UserCog } from "lucide-react";
import { api } from "../api";
import { usePolling } from "../hooks";
import { Ctx, Notificacao, ROTULO_PAPEL } from "../types";
import { PaginaId } from "../components/Layout";
import { Alerta, PaginaTopo, Vazio, desde } from "../components/ui";

/**
 * Visão geral. Mostra apenas o que existe de verdade no backend: por enquanto, a
 * conta do usuário e os avisos que ele recebeu.
 *
 * Os indicadores do novo domínio (eventos publicados, ingressos vendidos,
 * receita, pedidos pendentes) chegam junto com os serviços que os produzem —
 * nada aqui é preenchido com dado inventado.
 */
export function Visao({ ctx, ir }: { ctx: Ctx; ir: (p: PaginaId) => void }) {
  const [avisos, setAvisos] = useState<Notificacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  usePolling(async () => {
    try {
      setAvisos(await api<Notificacao[]>("GET", "notificacoes/minhas?limite=6"));
      setErro(null);
    } catch (e) {
      setAvisos([]);
      setErro(`Notificações indisponíveis (${(e as Error).message}). O restante do sistema continua funcionando.`);
    }
  }, 5000, []);

  return (
    <>
      <PaginaTopo
        titulo={`Olá, ${ctx.eu.nome.split(" ")[0]}`}
        descricao={
          ctx.eu.papel === "ORGANIZADOR"
            ? "Aqui você vai acompanhar seus eventos, as vendas e a validação na entrada."
            : ctx.eu.papel === "ADM"
            ? "Acesso completo à plataforma: contas, eventos, pedidos e pagamentos."
            : "Aqui você vai encontrar eventos, comprar ingressos e acompanhar seus pedidos."
        }
      />

      <Alerta texto={erro} tipo="info" />

      <div className="grade g-2">
        <section className="cartao">
          <div className="cartao-cab"><h3>Sua conta</h3></div>
          <div className="lista">
            <div className="lista-item">
              <span className="icone" style={{ background: "var(--azul-fraco)", color: "var(--azul)" }}>
                <UserCog size={16} />
              </span>
              <div className="cresce">
                <div className="nome">{ctx.eu.nome}</div>
                <div className="meta">{ctx.eu.email ?? "—"} · {ROTULO_PAPEL[ctx.eu.papel]}</div>
              </div>
            </div>
          </div>
          <p className="sec" style={{ marginTop: 12 }}>
            <Ticket size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            O catálogo de eventos e a compra de ingressos entram nos próximos lotes.
          </p>
        </section>

        <section className="cartao">
          <div className="cartao-cab">
            <h3>Seus avisos</h3>
            <button className="b-fantasma b-pequeno" onClick={() => ir("avisos")}>Ver tudo</button>
          </div>
          {avisos.length === 0 ? (
            <Vazio
              icone={Bell}
              titulo="Nenhum aviso ainda"
              texto="Os avisos chegam quando sua conta muda e, em breve, a cada compra, emissão de ingresso ou alteração de evento."
            />
          ) : (
            <div className="lista">
              {avisos.map((n) => (
                <div key={n.id} className="lista-item">
                  <div className="cresce">
                    <div className="nome">{n.titulo}</div>
                    <div className="meta">{n.mensagem}</div>
                  </div>
                  <span className="tempo">{desde(n.criadoEm)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
