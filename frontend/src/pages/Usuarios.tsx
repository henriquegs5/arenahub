import { useMemo, useState } from "react";
import { Search, Trash2, Users as UsersIcon } from "lucide-react";
import { api } from "../api";
import { useAcao, useCarregar } from "../hooks";
import { Ctx, Papel, ROTULO_PAPEL, Usuario } from "../types";
import {
  Alerta, Carregando, Confirmacao, Escudo, Girando, PaginaTopo, Vazio, dataHora,
} from "../components/ui";

const PAPEIS: Papel[] = ["PARTICIPANTE", "ORGANIZADOR", "ADM"];

/**
 * Administração de contas (somente ADM).
 *
 * O backend recusa rebaixar ou excluir o último administrador, e é ele que
 * manda: esta tela só evita oferecer o que seria recusado.
 */
export function Usuarios({ ctx }: { ctx: Ctx }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Papel | "TODOS">("TODOS");

  const { dados, erro, carregando, recarregar } = useCarregar<Usuario[]>(
    () => api("GET", "auth/usuarios"), [], 15000
  );

  const usuarios = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (dados ?? []).filter((u) =>
      (filtro === "TODOS" || u.papel === filtro) &&
      (!termo || u.nome.toLowerCase().includes(termo) || (u.email ?? "").toLowerCase().includes(termo))
    );
  }, [dados, busca, filtro]);

  const adms = (dados ?? []).filter((u) => u.papel === "ADM").length;

  return (
    <>
      <PaginaTopo
        titulo="Usuários"
        descricao="Todas as contas da plataforma. Você pode alterar o perfil e excluir contas."
      />

      <div className="filtros">
        <div className="busca">
          <Search size={15} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou e-mail" aria-label="Buscar usuários" />
        </div>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as Papel | "TODOS")}
          aria-label="Filtrar por perfil" style={{ maxWidth: 190 }}>
          <option value="TODOS">Todos os perfis</option>
          {PAPEIS.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
        </select>
        <span className="ter" style={{ marginLeft: "auto" }}>
          {usuarios.length} de {dados?.length ?? 0} contas
        </span>
      </div>

      <Alerta texto={erro} />

      {carregando && !dados ? (
        <Carregando linhas={4} />
      ) : usuarios.length === 0 ? (
        <Vazio icone={UsersIcon} titulo="Nenhuma conta nesta seleção"
          texto="Tente outra busca ou mude o filtro de perfil." />
      ) : (
        <div className="tabela-caixa">
          {usuarios.map((u) => (
            <LinhaUsuario key={u.id} u={u} ctx={ctx} unicoAdm={adms <= 1} aoMudar={recarregar} />
          ))}
        </div>
      )}
    </>
  );
}

function LinhaUsuario(
  { u, ctx, unicoAdm, aoMudar }:
  { u: Usuario; ctx: Ctx; unicoAdm: boolean; aoMudar: () => Promise<void> }
) {
  const acao = useAcao();
  const [confirmando, setConfirmando] = useState(false);

  const souEu = u.id === ctx.eu.id;
  // O backend recusa rebaixar ou excluir o último ADM; aqui já nem oferecemos.
  const protegido = u.papel === "ADM" && unicoAdm;

  return (
    <div className="linha-usuario">
      <Escudo nome={u.nome} />
      <div className="cresce" style={{ minWidth: 0 }}>
        <div className="lin" style={{ gap: 7 }}>
          <b>{u.nome}</b>
          {souEu && <span className="selo azul">Você</span>}
        </div>
        <div className="meta corta">{u.email}</div>
        {u.criadoEm && <div className="meta">Desde {dataHora(u.criadoEm)}</div>}
      </div>

      <select
        value={u.papel}
        disabled={acao.ocupado || protegido}
        title={protegido ? "Não é possível rebaixar o último administrador" : "Alterar perfil"}
        aria-label={`Perfil de ${u.nome}`}
        style={{ maxWidth: 170 }}
        onChange={(e) =>
          acao.executar(async () => {
            await api("PATCH", `auth/usuarios/${u.id}`, { papel: e.target.value });
            await aoMudar();
          })
        }
      >
        {PAPEIS.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
      </select>

      <button
        className="b-fantasma b-pequeno b-icone"
        onClick={() => setConfirmando(true)}
        disabled={acao.ocupado || protegido}
        aria-label={`Excluir ${u.nome}`}
        title={protegido ? "Não é possível excluir o último administrador" : "Excluir conta"}
      >
        {acao.ocupado ? <Girando /> : <Trash2 size={15} />}
      </button>

      {acao.erro && (
        <div style={{ flexBasis: "100%" }}><Alerta texto={acao.erro} /></div>
      )}

      {confirmando && (
        <Confirmacao
          titulo={`Excluir ${u.nome}`}
          texto={
            souEu
              ? "Esta é a sua própria conta. Os seus pedidos e ingressos são cancelados e estornados, e você será desconectado."
              : "Os pedidos e ingressos desta conta são cancelados e estornados. Se a pessoa organiza eventos, eles são cancelados e os compradores avisados."
          }
          rotuloConfirmar="Excluir conta"
          perigo
          ocupado={acao.ocupado}
          aoCancelar={() => setConfirmando(false)}
          aoConfirmar={async () => {
            const ok = await acao.executar(async () => {
              await api("DELETE", `auth/usuarios/${u.id}`);
              await aoMudar();
            });
            if (ok) setConfirmando(false);
          }}
        />
      )}
    </div>
  );
}
