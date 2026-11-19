import { useState } from "react";
import {
  ArrowLeft, CalendarDays, CalendarPlus, Layers, MapPin, Pencil, Plus,
  Search, Ticket, Trash2, Users,
} from "lucide-react";
import { api } from "../api";
import { useAcao, useCarregar } from "../hooks";
import {
  Ctx, EventoDetalhe, EventoResumo, Lote, Setor, StatusEvento,
} from "../types";
import {
  Alerta, Campo, Carregando, Confirmacao, Escudo, Girando, Ocupacao, PaginaTopo,
  Selo, Vazio, dataHora, dataLonga, emReais, paraInputDataHora,
} from "../components/ui";
import { Compra } from "./Compra";

const SITUACOES: { valor: StatusEvento | "TODOS"; rotulo: string }[] = [
  { valor: "TODOS", rotulo: "Todas" },
  { valor: "VENDAS_ABERTAS", rotulo: "Vendas abertas" },
  { valor: "PUBLICADO", rotulo: "Publicados" },
  { valor: "VENDAS_ENCERRADAS", rotulo: "Vendas encerradas" },
  { valor: "RASCUNHO", rotulo: "Rascunhos" },
  { valor: "REALIZADO", rotulo: "Realizados" },
  { valor: "CANCELADO", rotulo: "Cancelados" },
];

export function Eventos({ ctx }: { ctx: Ctx }) {
  // Detalhe abre NO LUGAR da lista, não no fim da página: o usuário não precisa
  // rolar para achar o que acabou de clicar.
  const [aberto, setAberto] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  if (criando) return <FormEvento ctx={ctx} aoFechar={() => setCriando(false)} aoCriar={setAberto} />;
  if (aberto) return <Detalhe ctx={ctx} eventoId={aberto} aoVoltar={() => setAberto(null)} />;
  return <Catalogo ctx={ctx} aoAbrir={setAberto} aoCriar={() => setCriando(true)} />;
}

// ============================================================ catálogo

function Catalogo(
  { ctx, aoAbrir, aoCriar }:
  { ctx: Ctx; aoAbrir: (id: string) => void; aoCriar: () => void }
) {
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState<StatusEvento | "TODOS">("TODOS");
  const [soMeus, setSoMeus] = useState(false);

  const organiza = ctx.eu.papel === "ORGANIZADOR" || ctx.eu.papel === "ADM";

  const { dados, erro, carregando } = useCarregar<EventoResumo[]>(
    () => {
      const q = new URLSearchParams();
      if (situacao !== "TODOS") q.set("status", situacao);
      if (busca.trim()) q.set("busca", busca.trim());
      if (soMeus) q.set("meus", "1");
      return api("GET", `eventos?${q}`);
    },
    [situacao, busca, soMeus],
    8000
  );

  const eventos = dados ?? [];

  return (
    <>
      <PaginaTopo
        titulo="Eventos"
        descricao={
          organiza
            ? "Campeonatos, convenções e encontros. Crie, publique e acompanhe as vendas."
            : "Campeonatos, convenções e encontros. Escolha um evento para ver os setores e comprar."
        }
        acoes={
          ctx.eu.papel === "ORGANIZADOR" ? (
            <button className="b-primario" onClick={aoCriar}><CalendarPlus size={16} />Criar evento</button>
          ) : undefined
        }
      />

      <div className="filtros">
        <div className="busca">
          <Search size={15} />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou local"
            aria-label="Buscar eventos"
          />
        </div>
        <select
          value={situacao}
          onChange={(e) => setSituacao(e.target.value as StatusEvento | "TODOS")}
          aria-label="Filtrar por situação"
          style={{ maxWidth: 210 }}
        >
          {SITUACOES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
        </select>
        {organiza && (
          <button
            className={`aba-filtro ${soMeus ? "ativo" : ""}`}
            onClick={() => setSoMeus(!soMeus)}
          >
            Só os meus
          </button>
        )}
      </div>

      <Alerta texto={erro} />

      {carregando && eventos.length === 0 ? (
        <Carregando linhas={3} />
      ) : eventos.length === 0 ? (
        <Vazio
          icone={CalendarDays}
          titulo={busca || situacao !== "TODOS" || soMeus ? "Nenhum evento nesta seleção" : "Nenhum evento ainda"}
          texto={
            busca || situacao !== "TODOS" || soMeus
              ? "Tente outra busca ou mude o filtro de situação."
              : ctx.eu.papel === "ORGANIZADOR"
              ? "Crie o seu primeiro evento, monte os setores e abra as vendas."
              : "Quando um organizador publicar um evento, ele aparece aqui."
          }
          acao={
            ctx.eu.papel === "ORGANIZADOR" ? (
              <button className="b-primario" onClick={aoCriar}><CalendarPlus size={16} />Criar evento</button>
            ) : undefined
          }
        />
      ) : (
        <div className="grade g-cartoes">
          {eventos.map((e) => <CartaoEvento key={e.id} e={e} ctx={ctx} aoAbrir={aoAbrir} />)}
        </div>
      )}
    </>
  );
}

function CartaoEvento(
  { e, ctx, aoAbrir }: { e: EventoResumo; ctx: Ctx; aoAbrir: (id: string) => void }
) {
  const meu = e.organizadorId === ctx.eu.id;
  const vendendo = e.status === "VENDAS_ABERTAS";
  const esgotado = e.disponiveis === 0 && e.capacidade > 0;

  return (
    <article className="cartao cartao-evento" onClick={() => aoAbrir(e.id)} tabIndex={0}
      onKeyDown={(k) => { if (k.key === "Enter" || k.key === " ") { k.preventDefault(); aoAbrir(e.id); } }}
      role="button" aria-label={`Abrir ${e.nome}`}>
      <div className="lin" style={{ gap: 10, alignItems: "flex-start" }}>
        <Escudo nome={e.nome} tam="g" />
        <div className="cresce" style={{ minWidth: 0 }}>
          <h3 className="titulo-cartao">{e.nome}</h3>
          <div className="meta lin" style={{ gap: 6 }}>
            <CalendarDays size={13} />{dataHora(e.dataHora)}
          </div>
          <div className="meta lin" style={{ gap: 6 }}>
            <MapPin size={13} /><span className="corta">{e.local}</span>
          </div>
        </div>
        <Selo status={e.status} />
      </div>

      {e.descricao && <p className="sec corta-2 mt">{e.descricao}</p>}

      <div className="sep" />

      {e.capacidade > 0 ? (
        <Ocupacao reservados={e.reservados} capacidade={e.capacidade} />
      ) : (
        <p className="sec">Sem setores cadastrados.</p>
      )}

      <div className="lin mt" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="ter" style={{ fontSize: ".72rem" }}>
            {e.precoMinimoCentavos !== null ? "A partir de" : "Preço"}
          </div>
          <b style={{ fontSize: "1.05rem" }}>
            {e.precoMinimoCentavos !== null ? emReais(e.precoMinimoCentavos) : "—"}
          </b>
        </div>
        <span className="b-secundario b-pequeno" aria-hidden="true">
          {vendendo && !esgotado ? <><Ticket size={14} />Comprar</> : meu ? <><Pencil size={14} />Gerenciar</> : "Ver detalhes"}
        </span>
      </div>
    </article>
  );
}

// ============================================================ detalhe

function Detalhe(
  { ctx, eventoId, aoVoltar }: { ctx: Ctx; eventoId: string; aoVoltar: () => void }
) {
  const { dados: e, erro, carregando, recarregar } = useCarregar<EventoDetalhe>(
    () => api("GET", `eventos/${eventoId}`), [eventoId], 6000
  );
  const acao = useAcao();
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState<"excluir" | "cancelar" | null>(null);
  const [motivo, setMotivo] = useState("");

  if (carregando && !e) return <><Voltar aoVoltar={aoVoltar} /><Carregando linhas={4} /></>;
  if (erro && !e) return <><Voltar aoVoltar={aoVoltar} /><Alerta texto={erro} /></>;
  if (!e) return null;

  const meu = e.organizadorId === ctx.eu.id;
  const podeGerir = meu || ctx.eu.papel === "ADM";
  const vendendo = e.status === "VENDAS_ABERTAS";
  const compra = ctx.eu.papel !== "ORGANIZADOR";

  if (editando) {
    return <FormEvento ctx={ctx} evento={e} aoFechar={() => { setEditando(false); void recarregar(); }} />;
  }

  const transicao = (caminho: string, ok: string) =>
    acao.executar(async () => { await api("POST", `eventos/${e.id}/${caminho}`); await recarregar(); }, ok);

  return (
    <>
      <Voltar aoVoltar={aoVoltar} />

      <PaginaTopo
        titulo={e.nome}
        descricao={`${dataLonga(e.dataHora)} · ${e.local}`}
        acoes={
          podeGerir ? (
            <>
              <button className="b-secundario" onClick={() => setEditando(true)} disabled={acao.ocupado}>
                <Pencil size={15} />Editar
              </button>
              {e.status === "RASCUNHO" && (
                <button className="b-primario" onClick={() => transicao("publicar", "Evento publicado.")} disabled={acao.ocupado}>
                  {acao.ocupado && <Girando />}Publicar
                </button>
              )}
              {e.status === "PUBLICADO" && (
                <button className="b-primario" onClick={() => transicao("abrir-vendas", "Vendas abertas.")} disabled={acao.ocupado}>
                  {acao.ocupado && <Girando />}Abrir vendas
                </button>
              )}
              {e.status === "VENDAS_ABERTAS" && (
                <button className="b-secundario" onClick={() => transicao("encerrar-vendas", "Vendas encerradas.")} disabled={acao.ocupado}>
                  Encerrar vendas
                </button>
              )}
              {e.status === "VENDAS_ENCERRADAS" && (
                <button className="b-secundario" onClick={() => transicao("realizar", "Evento marcado como realizado.")} disabled={acao.ocupado}>
                  Marcar como realizado
                </button>
              )}
              {["RASCUNHO", "PUBLICADO"].includes(e.status) && e.reservados === 0 && (
                <button className="b-perigo" onClick={() => setConfirmando("excluir")} disabled={acao.ocupado}>
                  <Trash2 size={15} />Excluir
                </button>
              )}
              {!["REALIZADO", "CANCELADO"].includes(e.status) && (
                <button className="b-perigo" onClick={() => setConfirmando("cancelar")} disabled={acao.ocupado}>
                  Cancelar evento
                </button>
              )}
            </>
          ) : undefined
        }
      />

      <div className="lin mb" style={{ gap: 10, flexWrap: "wrap" }}>
        <Selo status={e.status} />
        <span className="ter">Organizado por {ctx.nomeUsuario(e.organizadorId)}</span>
      </div>

      <Alerta texto={acao.erro} />
      <Alerta texto={acao.sucesso} tipo="ok" />
      {e.status === "CANCELADO" && e.motivoCancelamento && (
        <Alerta texto={`Evento cancelado. Motivo: ${e.motivoCancelamento}`} />
      )}

      <div className="grade g-2">
        <div className="col" style={{ gap: 14 }}>
          {e.descricao && (
            <section className="cartao">
              <div className="cartao-cab"><h3>Sobre o evento</h3></div>
              <p className="sec">{e.descricao}</p>
            </section>
          )}

          <Estrutura ctx={ctx} e={e} podeGerir={podeGerir} aoMudar={recarregar} />
        </div>

        <div className="col" style={{ gap: 14 }}>
          <section className="cartao">
            <div className="cartao-cab"><h3>Disponibilidade</h3></div>
            {e.capacidade > 0 ? (
              <>
                <Ocupacao reservados={e.reservados} capacidade={e.capacidade} />
                <div className="sep" />
                <div className="lista">
                  <Linha rotulo="Capacidade total" valor={`${e.capacidade} lugares`} />
                  <Linha rotulo="Disponíveis" valor={`${e.disponiveis} lugares`} />
                  <Linha rotulo="A partir de" valor={emReais(e.precoMinimoCentavos)} />
                </div>
                <p className="sec mt" style={{ fontSize: ".74rem" }}>
                  A capacidade é a soma dos lotes de cada setor.
                </p>
              </>
            ) : (
              <p className="sec">
                Nenhum setor cadastrado ainda. A capacidade do evento é a soma dos lotes.
              </p>
            )}
          </section>

          {compra && vendendo && e.disponiveis > 0 && (
            <Compra ctx={ctx} evento={e} aoComprar={recarregar} />
          )}
          {compra && vendendo && e.disponiveis === 0 && (
            <section className="cartao">
              <div className="cartao-cab"><h3>Comprar ingresso</h3></div>
              <p className="sec">Todos os lugares deste evento foram vendidos.</p>
            </section>
          )}
          {compra && !vendendo && e.status !== "CANCELADO" && (
            <section className="cartao">
              <div className="cartao-cab"><h3>Comprar ingresso</h3></div>
              <p className="sec">
                {e.status === "PUBLICADO" ? "As vendas ainda não foram abertas para este evento."
                  : e.status === "VENDAS_ENCERRADAS" ? "As vendas deste evento foram encerradas."
                  : "Este evento não está vendendo ingressos."}
              </p>
            </section>
          )}
        </div>
      </div>

      {confirmando === "excluir" && (
        <Confirmacao
          titulo="Excluir evento"
          texto="O evento e os setores são apagados de vez. Só é possível porque ninguém comprou ingresso."
          rotuloConfirmar="Excluir"
          perigo
          ocupado={acao.ocupado}
          aoCancelar={() => setConfirmando(null)}
          aoConfirmar={() =>
            acao.executar(async () => { await api("DELETE", `eventos/${e.id}`); aoVoltar(); })
          }
        />
      )}

      {confirmando === "cancelar" && (
        <div className="fundo-modal" role="dialog" aria-modal="true" onClick={() => setConfirmando(null)}>
          <div className="modal" onClick={(ev) => ev.stopPropagation()}>
            <h3>Cancelar evento</h3>
            <p>
              Os ingressos vendidos são invalidados, os lugares voltam ao estoque e os
              compradores são estornados e avisados. Não dá para desfazer.
            </p>
            <div className="campo mt">
              <label htmlFor="motivo-cancel">Motivo<span className="obrigatorio"> *</span></label>
              <input
                id="motivo-cancel"
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
                placeholder="Ex.: problema estrutural no local"
              />
              <small className="ajuda">O motivo aparece no aviso enviado a quem comprou.</small>
            </div>
            <div className="botoes">
              <button className="b-secundario" onClick={() => setConfirmando(null)} disabled={acao.ocupado}>Voltar</button>
              <button
                className="b-perigo"
                disabled={acao.ocupado || motivo.trim().length < 3}
                onClick={async () => {
                  const ok = await acao.executar(async () => {
                    await api("POST", `eventos/${e.id}/cancelar`, { motivo: motivo.trim() });
                    await recarregar();
                  }, "Evento cancelado. Os compradores estão sendo avisados.");
                  if (ok) { setConfirmando(null); setMotivo(""); }
                }}
              >
                {acao.ocupado && <Girando />}Cancelar evento
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const Voltar = ({ aoVoltar }: { aoVoltar: () => void }) => (
  <button className="b-fantasma b-pequeno mb" onClick={aoVoltar}>
    <ArrowLeft size={15} />Voltar aos eventos
  </button>
);

const Linha = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
  <div className="lista-item">
    <span className="cresce sec">{rotulo}</span>
    <b>{valor}</b>
  </div>
);

// ============================================================ setores e lotes

function Estrutura(
  { ctx, e, podeGerir, aoMudar }:
  { ctx: Ctx; e: EventoDetalhe; podeGerir: boolean; aoMudar: () => Promise<void> }
) {
  const acao = useAcao();
  const [novoSetor, setNovoSetor] = useState(false);
  const [nomeSetor, setNomeSetor] = useState("");
  const [descSetor, setDescSetor] = useState("");

  // Estrutura só muda antes de as vendas encerrarem (regra do State no backend).
  const editavel = podeGerir && ["RASCUNHO", "PUBLICADO", "VENDAS_ABERTAS"].includes(e.status);

  return (
    <section className="cartao">
      <div className="cartao-cab">
        <h3>Setores e lotes</h3>
        {editavel && !novoSetor && (
          <button className="b-secundario b-pequeno" onClick={() => setNovoSetor(true)}>
            <Plus size={14} />Novo setor
          </button>
        )}
      </div>

      <Alerta texto={acao.erro} />

      {novoSetor && (
        <div className="caixa-form mb">
          <div className="linha-campos">
            <Campo id="setor-nome" rotulo="Nome do setor" obrigatorio ajuda="Ex.: Pista, Arquibancada, Camarote">
              <input id="setor-nome" value={nomeSetor} onChange={(x) => setNomeSetor(x.target.value)} autoFocus />
            </Campo>
            <Campo id="setor-desc" rotulo="Descrição" ajuda="Opcional. O que esse setor oferece.">
              <input id="setor-desc" value={descSetor} onChange={(x) => setDescSetor(x.target.value)} />
            </Campo>
          </div>
          <div className="lin-fim mt">
            <button className="b-fantasma" onClick={() => { setNovoSetor(false); setNomeSetor(""); setDescSetor(""); }}>
              Cancelar
            </button>
            <button
              className="b-primario"
              disabled={acao.ocupado || nomeSetor.trim().length < 2}
              onClick={async () => {
                const ok = await acao.executar(async () => {
                  await api("POST", `eventos/${e.id}/setores`, {
                    nome: nomeSetor.trim(), descricao: descSetor.trim() || null,
                  });
                  await aoMudar();
                });
                if (ok) { setNovoSetor(false); setNomeSetor(""); setDescSetor(""); }
              }}
            >
              {acao.ocupado && <Girando />}Criar setor
            </button>
          </div>
        </div>
      )}

      {e.setores.length === 0 ? (
        <Vazio
          icone={Layers}
          titulo="Nenhum setor ainda"
          texto={
            editavel
              ? "Crie um setor e adicione lotes com preço e capacidade. A capacidade do evento é a soma dos lotes."
              : "Este evento ainda não tem setores cadastrados."
          }
        />
      ) : (
        <div className="col" style={{ gap: 12 }}>
          {e.setores.map((s) => (
            <BlocoSetor key={s.id} ctx={ctx} evento={e} setor={s} editavel={editavel} aoMudar={aoMudar} />
          ))}
        </div>
      )}
    </section>
  );
}

function BlocoSetor(
  { evento, setor, editavel, aoMudar }:
  { ctx: Ctx; evento: EventoDetalhe; setor: Setor; editavel: boolean; aoMudar: () => Promise<void> }
) {
  const acao = useAcao();
  const [novoLote, setNovoLote] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className="bloco-setor">
      <div className="lin" style={{ gap: 8, alignItems: "flex-start" }}>
        <div className="cresce">
          <b>{setor.nome}</b>
          {setor.descricao && <div className="meta">{setor.descricao}</div>}
          <div className="meta">
            {setor.capacidade} lugares · {setor.disponiveis} disponíveis
          </div>
        </div>
        {editavel && (
          <div className="lin" style={{ gap: 4 }}>
            <button className="b-fantasma b-pequeno" onClick={() => setNovoLote(true)}>
              <Plus size={13} />Lote
            </button>
            <button
              className="b-fantasma b-pequeno b-icone"
              onClick={() => setConfirmando(true)}
              aria-label={`Excluir setor ${setor.nome}`}
              title={setor.reservados > 0 ? "Setor com vendas não pode ser excluído" : "Excluir setor"}
              disabled={setor.reservados > 0}
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <Alerta texto={acao.erro} />

      {setor.lotes.length > 0 && (
        <div className="tabela-lotes mt">
          {setor.lotes.map((l) => (
            <LinhaLote key={l.id} evento={evento} lote={l} editavel={editavel} aoMudar={aoMudar} />
          ))}
        </div>
      )}

      {novoLote && (
        <FormLote
          evento={evento}
          setorId={setor.id}
          aoFechar={() => setNovoLote(false)}
          aoSalvar={aoMudar}
        />
      )}

      {setor.lotes.length === 0 && !novoLote && (
        <p className="sec mt" style={{ fontSize: ".8rem" }}>
          Setor sem lotes: ainda não cria lugares. {editavel && "Adicione um lote com preço e capacidade."}
        </p>
      )}

      {confirmando && (
        <Confirmacao
          titulo="Excluir setor"
          texto={`O setor "${setor.nome}" e os seus lotes serão apagados.`}
          rotuloConfirmar="Excluir"
          perigo
          ocupado={acao.ocupado}
          aoCancelar={() => setConfirmando(false)}
          aoConfirmar={async () => {
            const ok = await acao.executar(async () => {
              await api("DELETE", `eventos/${evento.id}/setores/${setor.id}`);
              await aoMudar();
            });
            if (ok) setConfirmando(false);
          }}
        />
      )}
    </div>
  );
}

function LinhaLote(
  { evento, lote, editavel, aoMudar }:
  { evento: EventoDetalhe; lote: Lote; editavel: boolean; aoMudar: () => Promise<void> }
) {
  const acao = useAcao();
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  if (editando) {
    return (
      <FormLote
        evento={evento}
        lote={lote}
        aoFechar={() => setEditando(false)}
        aoSalvar={aoMudar}
      />
    );
  }

  return (
    <>
      <div className="linha-lote">
        <div className="cresce" style={{ minWidth: 0 }}>
          <div className="lin" style={{ gap: 7 }}>
            <b>{lote.nome}</b>
            {!lote.vigente && <span className="selo neutro">Fora de vigência</span>}
          </div>
          <div className="meta">
            {lote.disponiveis} de {lote.capacidade} disponíveis
            {lote.descontoPercentual > 0 && ` · ${lote.descontoPercentual}% de desconto`}
            {(lote.inicioVendas || lote.fimVendas) && (
              ` · vende ${lote.inicioVendas ? `de ${dataHora(lote.inicioVendas)}` : ""}${lote.fimVendas ? ` até ${dataHora(lote.fimVendas)}` : ""}`
            )}
          </div>
        </div>
        <b style={{ whiteSpace: "nowrap" }}>{lote.precoFormatado}</b>
        {editavel && (
          <div className="lin" style={{ gap: 2 }}>
            <button className="b-fantasma b-pequeno b-icone" onClick={() => setEditando(true)}
              aria-label={`Editar lote ${lote.nome}`} title="Editar">
              <Pencil size={13} />
            </button>
            <button
              className="b-fantasma b-pequeno b-icone"
              onClick={() => setConfirmando(true)}
              disabled={lote.reservados > 0}
              aria-label={`Excluir lote ${lote.nome}`}
              title={lote.reservados > 0 ? "Lote com vendas não pode ser excluído" : "Excluir"}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
      <Alerta texto={acao.erro} />

      {confirmando && (
        <Confirmacao
          titulo="Excluir lote"
          texto={`O lote "${lote.nome}" será apagado e a capacidade do evento diminui.`}
          rotuloConfirmar="Excluir"
          perigo
          ocupado={acao.ocupado}
          aoCancelar={() => setConfirmando(false)}
          aoConfirmar={async () => {
            const ok = await acao.executar(async () => {
              await api("DELETE", `eventos/${evento.id}/lotes/${lote.id}`);
              await aoMudar();
            });
            if (ok) setConfirmando(false);
          }}
        />
      )}
    </>
  );
}

function FormLote(
  { evento, setorId, lote, aoFechar, aoSalvar }:
  {
    evento: EventoDetalhe; setorId?: string; lote?: Lote;
    aoFechar: () => void; aoSalvar: () => Promise<void>;
  }
) {
  const acao = useAcao();
  const [f, setF] = useState({
    nome: lote?.nome ?? "",
    // O backend trabalha em centavos; a tela mostra reais.
    preco: lote ? (lote.precoCentavos / 100).toFixed(2) : "",
    capacidade: lote ? String(lote.capacidade) : "",
    desconto: String(lote?.descontoPercentual ?? 0),
    inicio: paraInputDataHora(lote?.inicioVendas),
    fim: paraInputDataHora(lote?.fimVendas),
  });

  const precoCentavos = Math.round(Number(f.preco.replace(",", ".")) * 100);
  const capacidade = Number(f.capacidade);
  const valido =
    f.nome.trim().length >= 2 &&
    Number.isFinite(precoCentavos) && precoCentavos >= 0 &&
    Number.isInteger(capacidade) && capacidade >= 1;

  const salvar = async () => {
    const corpo = {
      nome: f.nome.trim(),
      precoCentavos,
      capacidade,
      descontoPercentual: Number(f.desconto) || 0,
      inicioVendas: f.inicio ? new Date(f.inicio).toISOString() : null,
      fimVendas: f.fim ? new Date(f.fim).toISOString() : null,
    };
    const ok = await acao.executar(async () => {
      if (lote) await api("PATCH", `eventos/${evento.id}/lotes/${lote.id}`, corpo);
      else await api("POST", `eventos/${evento.id}/setores/${setorId}/lotes`, corpo);
      await aoSalvar();
    });
    if (ok) aoFechar();
  };

  return (
    <div className="caixa-form mt">
      <div className="linha-campos">
        <Campo id="lote-nome" rotulo="Nome do lote" obrigatorio ajuda="Ex.: 1º lote, Pré-venda">
          <input id="lote-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus />
        </Campo>
        <Campo id="lote-preco" rotulo="Preço (R$)" obrigatorio ajuda="Preço cheio. A meia-entrada sai pela metade.">
          <input id="lote-preco" inputMode="decimal" value={f.preco}
            onChange={(e) => setF({ ...f, preco: e.target.value })} placeholder="0,00" />
        </Campo>
        <Campo id="lote-cap" rotulo="Capacidade" obrigatorio
          ajuda={lote && lote.reservados > 0 ? `Não pode ficar abaixo de ${lote.reservados} (já vendidos)` : "Quantos lugares este lote oferece"}>
          <input id="lote-cap" inputMode="numeric" value={f.capacidade}
            onChange={(e) => setF({ ...f, capacidade: e.target.value })} />
        </Campo>
        <Campo id="lote-desc" rotulo="Desconto promocional (%)" ajuda="Usado pela política Promocional. 0 = sem desconto.">
          <input id="lote-desc" inputMode="numeric" value={f.desconto}
            onChange={(e) => setF({ ...f, desconto: e.target.value })} />
        </Campo>
        <Campo id="lote-ini" rotulo="Início das vendas" ajuda="Opcional. Vazio = vende desde já.">
          <input id="lote-ini" type="datetime-local" value={f.inicio}
            onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        </Campo>
        <Campo id="lote-fim" rotulo="Fim das vendas" ajuda="Opcional. Vazio = sem prazo.">
          <input id="lote-fim" type="datetime-local" value={f.fim}
            onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </Campo>
      </div>

      <Alerta texto={acao.erro} />

      <div className="lin-fim mt">
        <button className="b-fantasma" onClick={aoFechar} disabled={acao.ocupado}>Cancelar</button>
        <button className="b-primario" onClick={salvar} disabled={acao.ocupado || !valido}>
          {acao.ocupado && <Girando />}{lote ? "Salvar lote" : "Criar lote"}
        </button>
      </div>
    </div>
  );
}

// ============================================================ criar/editar evento

function FormEvento(
  { evento, aoFechar, aoCriar }:
  { ctx: Ctx; evento?: EventoDetalhe; aoFechar: () => void; aoCriar?: (id: string) => void }
) {
  const acao = useAcao();
  const [f, setF] = useState({
    nome: evento?.nome ?? "",
    descricao: evento?.descricao ?? "",
    local: evento?.local ?? "",
    dataHora: paraInputDataHora(evento?.dataHora),
  });

  const valido =
    f.nome.trim().length >= 3 && f.local.trim().length >= 3 && !!f.dataHora;

  const salvar = async () => {
    const corpo = {
      nome: f.nome.trim(),
      descricao: f.descricao.trim() || null,
      local: f.local.trim(),
      dataHora: new Date(f.dataHora).toISOString(),
    };
    const ok = await acao.executar(async () => {
      if (evento) {
        await api("PATCH", `eventos/${evento.id}`, corpo);
      } else {
        const criado = await api<EventoDetalhe>("POST", "eventos", corpo);
        aoCriar?.(criado.id);
      }
    });
    if (ok) aoFechar();
  };

  return (
    <>
      <button className="b-fantasma b-pequeno mb" onClick={aoFechar}>
        <ArrowLeft size={15} />Voltar
      </button>

      <PaginaTopo
        titulo={evento ? "Editar evento" : "Criar evento"}
        descricao={
          evento
            ? "Mudanças de nome, data ou local avisam automaticamente quem já comprou ingresso."
            : "O evento nasce como rascunho. Monte os setores e lotes antes de publicar."
        }
      />

      <section className="cartao" style={{ maxWidth: 720 }}>
        <div className="linha-campos">
          <Campo id="ev-nome" rotulo="Nome do evento" obrigatorio ajuda="Mínimo de 3 caracteres.">
            <input id="ev-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus
              placeholder="Ex.: Arena Championship 2026" />
          </Campo>
          <Campo id="ev-local" rotulo="Local" obrigatorio ajuda="Onde o evento acontece.">
            <input id="ev-local" value={f.local} onChange={(e) => setF({ ...f, local: e.target.value })}
              placeholder="Ex.: Jeunesse Arena, Rio de Janeiro" />
          </Campo>
          <Campo id="ev-data" rotulo="Data e hora" obrigatorio ajuda="Quando o evento começa.">
            <input id="ev-data" type="datetime-local" value={f.dataHora}
              onChange={(e) => setF({ ...f, dataHora: e.target.value })} />
          </Campo>
        </div>

        <div className="campo mt">
          <label htmlFor="ev-desc">Descrição</label>
          <textarea id="ev-desc" rows={4} value={f.descricao}
            onChange={(e) => setF({ ...f, descricao: e.target.value })}
            placeholder="O que acontece no evento, atrações, regras de entrada..." />
          <small className="ajuda">Opcional. Aparece no cartão e na página do evento.</small>
        </div>

        <Alerta texto={acao.erro} />

        <div className="lin-fim mt">
          <button className="b-fantasma" onClick={aoFechar} disabled={acao.ocupado}>Cancelar</button>
          <button className="b-primario" onClick={salvar} disabled={acao.ocupado || !valido}>
            {acao.ocupado && <Girando />}{evento ? "Salvar alterações" : "Criar evento"}
          </button>
        </div>
      </section>

      {!evento && (
        <p className="sec mt" style={{ maxWidth: 720 }}>
          <Users size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Depois de criar, adicione setores e lotes. A capacidade do evento é a soma dos lotes.
        </p>
      )}
    </>
  );
}
