import { useMemo, useState } from "react";
import { ChevronDown, Crown, Plus, Search, Trophy } from "lucide-react";
import { api } from "../api";
import { usePolling, useTorneios } from "../hooks";
import { Ctx, Formato, Inscricao, RodadaChave, Torneio } from "../types";
import { Alerta, Confirmacao, Escudo, Girando, PaginaTopo, ROTULO_FORMATO, Selo, Stat, Vazio } from "../components/ui";

const FILTROS = [
  { id: "todos", nome: "Todos" },
  { id: "INSCRICOES_ABERTAS", nome: "Inscrições abertas" },
  { id: "EM_ANDAMENTO", nome: "Em andamento" },
  { id: "FINALIZADO", nome: "Finalizados" },
  { id: "RASCUNHO", nome: "Rascunhos" },
  { id: "CANCELADO", nome: "Cancelados" },
];

export function Torneios({ ctx }: { ctx: Ctx }) {
  const { torneios, erro: erroLista, recarregar } = useTorneios(4000);
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [confirmar, setConfirmar] = useState<Torneio | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const acao = async (id: string, caminho: string) => {
    setOcupado(id + caminho);
    try { await api("POST", `torneios/${id}/${caminho}`); setErro(null); await recarregar(); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(null); }
  };

  const visiveis = useMemo(() => torneios
    .filter((t) => filtro === "todos" || t.status === filtro)
    .filter((t) => t.nome.toLowerCase().includes(busca.trim().toLowerCase())), [torneios, filtro, busca]);
  const conta = (id: string) => id === "todos" ? torneios.length : torneios.filter((t) => t.status === id).length;

  return (
    <>
      <PaginaTopo
        titulo="Torneios"
        descricao="Crie campeonatos, abra inscrições, gere os confrontos e acompanhe cada chave até o campeão."
        acoes={ctx.eu.papel === "ORGANIZADOR"
          ? <button className="b-primario" onClick={() => setCriando(!criando)}><Plus size={16} />Criar torneio</button>
          : undefined}
      />

      <div className="grade g-stats mb">
        <Stat icone={Trophy} cor="azul" valor={torneios.length} rotulo="Total de torneios" />
        <Stat icone={Trophy} cor="ambar" valor={conta("EM_ANDAMENTO")} rotulo="Em andamento" />
        <Stat icone={Trophy} cor="verde" valor={conta("FINALIZADO")} rotulo="Finalizados" />
        <Stat icone={Trophy} cor="vermelho" valor={conta("INSCRICOES_ABERTAS")} rotulo="Com inscrições abertas" />
      </div>

      {criando && ctx.eu.papel === "ORGANIZADOR" && (
        <FormularioTorneio aoCriar={async () => { setCriando(false); await recarregar(); }} aoCancelar={() => setCriando(false)} />
      )}

      <Alerta texto={erro ?? erroLista} />

      <div className="filtros">
        {FILTROS.map((f) => (
          <button key={f.id} className={`aba-filtro ${filtro === f.id ? "ativo" : ""}`} onClick={() => setFiltro(f.id)}>
            {f.nome}<span className="n">{conta(f.id)}</span>
          </button>
        ))}
        <div className="busca">
          <Search size={15} />
          <input placeholder="Buscar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar torneio" />
        </div>
      </div>

      {visiveis.length === 0 ? (
        <Vazio icone={Trophy}
          titulo={torneios.length === 0 ? "Nenhum torneio ainda" : "Nada neste filtro"}
          texto={torneios.length === 0
            ? (ctx.eu.papel === "ORGANIZADOR" ? "Crie o primeiro campeonato e abra as inscrições para as equipes." : "Assim que um organizador criar um torneio, ele aparece aqui.")
            : "Nenhum torneio corresponde ao filtro ou à busca atual."} />
      ) : (
        <div className="grade g-cartoes">
          {visiveis.map((t) => (
            <CartaoTorneio key={t.id} t={t} ctx={ctx} ocupado={ocupado}
              aberto={aberto === t.id} aoAbrir={() => setAberto(aberto === t.id ? null : t.id)}
              aoAgir={acao} aoCancelar={() => setConfirmar(t)} />
          ))}
        </div>
      )}

      {aberto && torneios.find((t) => t.id === aberto) && (
        <Detalhe ctx={ctx} torneio={torneios.find((t) => t.id === aberto)!} />
      )}

      {confirmar && (
        <Confirmacao
          titulo={`Cancelar ${confirmar.nome}?`}
          texto="O torneio é encerrado e não pode ser retomado. As inscrições e partidas deixam de valer."
          rotuloConfirmar="Cancelar torneio" perigo
          aoCancelar={() => setConfirmar(null)}
          aoConfirmar={() => { const t = confirmar; setConfirmar(null); acao(t.id, "cancelar"); }}
        />
      )}
    </>
  );
}

function CartaoTorneio(
  { t, ctx, aberto, ocupado, aoAbrir, aoAgir, aoCancelar }:
  { t: Torneio; ctx: Ctx; aberto: boolean; ocupado: string | null; aoAbrir: () => void; aoAgir: (id: string, c: string) => void; aoCancelar: () => void }
) {
  const dono = t.organizadorId === ctx.eu.id;
  const podeCancelar = dono && ["RASCUNHO", "INSCRICOES_ABERTAS", "EM_ANDAMENTO"].includes(t.status);
  return (
    <section className="cartao">
      <div className="cartao-cab">
        <Escudo nome={t.nome} />
        <h3>{t.nome}</h3>
        <Selo status={t.status} />
      </div>
      <dl className="col" style={{ gap: 6, margin: 0 }}>
        <div className="lin" style={{ justifyContent: "space-between" }}><dt className="sec">Formato</dt><dd style={{ margin: 0 }}>{ROTULO_FORMATO[t.formato]}</dd></div>
        <div className="lin" style={{ justifyContent: "space-between" }}><dt className="sec">Organizador</dt><dd style={{ margin: 0 }}>{ctx.nomeUsuario(t.organizadorId)}</dd></div>
        <div className="lin" style={{ justifyContent: "space-between" }}><dt className="sec">Vagas</dt><dd style={{ margin: 0 }}>até {t.maxEquipes} equipes</dd></div>
      </dl>
      {t.campeaoId && (
        <div className="lin mt" style={{ color: "var(--ambar)" }}><Crown size={16} /><b>{ctx.nomeEquipe(t.campeaoId)}</b> <span className="sec">campeã</span></div>
      )}
      <div className="sep" />
      <div className="lin">
        <button className="b-secundario b-pequeno" onClick={aoAbrir}>
          <ChevronDown size={15} style={{ transform: aberto ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
          {aberto ? "Ocultar" : "Detalhes"}
        </button>
        {dono && t.status === "RASCUNHO" && (
          <button className="b-primario b-pequeno" disabled={!!ocupado} onClick={() => aoAgir(t.id, "abrir")}>
            {ocupado === t.id + "abrir" && <Girando />}Abrir inscrições
          </button>
        )}
        {dono && t.status === "INSCRICOES_ABERTAS" && (
          <button className="b-primario b-pequeno" disabled={!!ocupado} onClick={() => aoAgir(t.id, "iniciar")}>
            {ocupado === t.id + "iniciar" && <Girando />}Iniciar torneio
          </button>
        )}
        {podeCancelar && <button className="b-perigo b-pequeno" onClick={aoCancelar}>Cancelar</button>}
      </div>
    </section>
  );
}

function FormularioTorneio({ aoCriar, aoCancelar }: { aoCriar: () => Promise<void>; aoCancelar: () => void }) {
  const [f, setF] = useState({ nome: "", formato: "ELIMINACAO_SIMPLES" as Formato, maxEquipes: 4 });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const nomeInvalido = f.nome.trim().length > 0 && f.nome.trim().length < 2;
  const vagasInvalidas = f.maxEquipes < 2 || f.maxEquipes > 32;

  const enviar = async () => {
    setSalvando(true);
    try { await api("POST", "torneios", { ...f, nome: f.nome.trim() }); setErro(null); await aoCriar(); }
    catch (e) { setErro((e as Error).message); }
    finally { setSalvando(false); }
  };

  return (
    <form className="cartao mb" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
      <h3 className="mb">Novo torneio</h3>
      <div className="linha-campos">
        <div className="campo">
          <label htmlFor="t-nome">Nome <span className="obrigatorio">*</span></label>
          <input id="t-nome" className={nomeInvalido ? "invalido" : ""} placeholder="Copa de Verão" value={f.nome}
            onChange={(e) => setF({ ...f, nome: e.target.value })} />
          {nomeInvalido && <span className="erro-campo">Use ao menos 2 caracteres.</span>}
        </div>
        <div className="campo">
          <label htmlFor="t-formato">Formato <span className="obrigatorio">*</span></label>
          <select id="t-formato" value={f.formato} onChange={(e) => setF({ ...f, formato: e.target.value as Formato })}>
            <option value="ELIMINACAO_SIMPLES">Eliminação simples</option>
            <option value="PONTOS_CORRIDOS">Pontos corridos</option>
          </select>
          <span className="ajuda">{f.formato === "ELIMINACAO_SIMPLES" ? "Quem perde está fora. Não há empate." : "Todos contra todos, em turno único."}</span>
        </div>
        <div className="campo">
          <label htmlFor="t-vagas">Limite de equipes <span className="obrigatorio">*</span></label>
          <input id="t-vagas" type="number" min={2} max={32} className={vagasInvalidas ? "invalido" : ""} value={f.maxEquipes}
            onChange={(e) => setF({ ...f, maxEquipes: Number(e.target.value) })} />
          {vagasInvalidas && <span className="erro-campo">Informe um número entre 2 e 32.</span>}
        </div>
      </div>
      <Alerta texto={erro} />
      <div className="lin lin-fim mt">
        <button type="button" className="b-secundario" onClick={aoCancelar}>Descartar</button>
        <button type="submit" className="b-primario" disabled={salvando || f.nome.trim().length < 2 || vagasInvalidas}>
          {salvando && <Girando />}Criar torneio
        </button>
      </div>
    </form>
  );
}

function Detalhe({ ctx, torneio }: { ctx: Ctx; torneio: Torneio }) {
  const [insc, setInsc] = useState<Inscricao[]>([]);
  const [chave, setChave] = useState<RodadaChave[]>([]);
  const [equipeId, setEquipeId] = useState("");
  const [msg, setMsg] = useState<{ texto: string; tipo: "erro" | "info" } | null>(null);

  usePolling(async () => {
    try {
      const [i, c] = await Promise.all([
        api<Inscricao[]>("GET", `torneios/${torneio.id}/inscricoes`),
        api<RodadaChave[]>("GET", `torneios/${torneio.id}/chave`),
      ]);
      setInsc(i); setChave(c);
    } catch (e) { setMsg({ texto: (e as Error).message, tipo: "erro" }); }
  }, 3000, [torneio.id]);

  const minhas = ctx.equipes.filter((e) => e.capitaoId === ctx.eu.id);
  const inscrever = async () => {
    try {
      await api("POST", `torneios/${torneio.id}/inscricoes`, { equipeId });
      setMsg({ texto: "Inscrição enviada. A validação da equipe acontece em segundo plano e o status aparece na lista abaixo.", tipo: "info" });
    } catch (e) { setMsg({ texto: (e as Error).message, tipo: "erro" }); }
  };
  const ativas = insc.filter((i) => i.status !== "REJEITADA").length;

  return (
    <section className="cartao mt">
      <div className="cartao-cab"><h3>{torneio.nome}</h3><Selo status={torneio.status} /></div>
      <Alerta texto={msg?.texto ?? null} tipo={msg?.tipo} />

      <div className="lin mb">
        <div className="cresce" style={{ flex: 1, minWidth: 180 }}>
          <div className="lin" style={{ justifyContent: "space-between" }}>
            <span className="sec">Equipes inscritas</span><span>{ativas} de {torneio.maxEquipes}</span>
          </div>
          <div className="barra mt" style={{ marginTop: 6 }}>
            <i style={{ width: `${Math.min(100, (ativas / torneio.maxEquipes) * 100)}%` }} />
          </div>
        </div>
      </div>

      {ctx.eu.papel === "JOGADOR" && torneio.status === "INSCRICOES_ABERTAS" && (
        minhas.length === 0
          ? <p className="sec mb">Só o capitão inscreve uma equipe. Crie a sua na página Equipes.</p>
          : (
            <div className="lin mb">
              <select value={equipeId} onChange={(e) => setEquipeId(e.target.value)} style={{ maxWidth: 260 }} aria-label="Equipe">
                <option value="">Escolha a equipe</option>
                {minhas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
              <button className="b-primario" disabled={!equipeId} onClick={inscrever}>Inscrever equipe</button>
            </div>
          )
      )}

      <h4 className="mb">Inscrições</h4>
      {insc.length === 0 ? <p className="sec">Nenhuma equipe inscrita até agora.</p> : (
        <div className="lista mb">
          {insc.map((i) => (
            <div key={i.id} className="lista-item">
              <Escudo nome={i.nomeEquipe ?? ctx.nomeEquipe(i.equipeId)} tam="p" />
              <div className="cresce">
                <div className="nome">{i.nomeEquipe ?? ctx.nomeEquipe(i.equipeId)}</div>
                {i.motivo && <div className="meta">{i.motivo}</div>}
              </div>
              <Selo status={i.status} />
            </div>
          ))}
        </div>
      )}

      <h4 className="mb">Chave</h4>
      {chave.length === 0 ? (
        <p className="sec">A chave é gerada automaticamente quando o organizador inicia o torneio.</p>
      ) : (
        <div className="chave">
          {chave.map((r) => (
            <div key={r.rodada} className="chave-rodada">
              <h4>Rodada {r.rodada}</h4>
              {r.partidas.map((p) => (
                <div key={p.partidaId} className="chave-par">
                  {p.bye ? (
                    <div className="chave-time bye"><span>{ctx.nomeEquipe(p.equipeA)} avança sem jogar</span></div>
                  ) : (
                    <>
                      <div className={`chave-time ${p.vencedorId === p.equipeA ? "venceu" : ""}`}>
                        <span>{ctx.nomeEquipe(p.equipeA)}</span><b className="gols">{p.placarA ?? "–"}</b>
                      </div>
                      <div className={`chave-time ${p.vencedorId === p.equipeB ? "venceu" : ""}`}>
                        <span>{ctx.nomeEquipe(p.equipeB)}</span><b className="gols">{p.placarB ?? "–"}</b>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
