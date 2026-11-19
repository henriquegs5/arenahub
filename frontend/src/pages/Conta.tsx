import { useState } from "react";
import { ShieldAlert, UserCircle } from "lucide-react";
import { api } from "../api";
import { useAcao } from "../hooks";
import { Ctx, ROTULO_PAPEL, Usuario } from "../types";
import { Alerta, Campo, Confirmacao, Girando, PaginaTopo } from "../components/ui";

/** Perfil do próprio usuário: editar nome, trocar senha e excluir a conta. */
export function Conta({ ctx, aoSair }: { ctx: Ctx; aoSair: () => void }) {
  const perfil = useAcao();
  const senha = useAcao();
  const exclusao = useAcao();

  const [nome, setNome] = useState(ctx.eu.nome);
  const [senhas, setSenhas] = useState({ atual: "", nova: "", confirma: "" });
  const [confirmando, setConfirmando] = useState(false);

  const nomeValido = nome.trim().length >= 2 && nome.trim() !== ctx.eu.nome;
  const senhaValida =
    senhas.atual.length >= 6 && senhas.nova.length >= 6 && senhas.nova === senhas.confirma;

  return (
    <>
      <PaginaTopo titulo="Minha conta" descricao="Seus dados de acesso ao ArenaHub." />

      <div className="grade g-2">
        <div className="col" style={{ gap: 14 }}>
          <section className="cartao">
            <div className="cartao-cab"><h3>Dados do perfil</h3></div>

            <Campo id="conta-email" rotulo="E-mail" ajuda="O e-mail de acesso não pode ser alterado.">
              <input id="conta-email" value={ctx.eu.email ?? "—"} disabled />
            </Campo>

            <Campo id="conta-papel" rotulo="Perfil" ajuda="Somente o administrador altera perfis.">
              <input id="conta-papel" value={ROTULO_PAPEL[ctx.eu.papel]} disabled />
            </Campo>

            <div className="mt">
              <Campo id="conta-nome" rotulo="Nome" obrigatorio ajuda="É como você aparece para os outros.">
                <input id="conta-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
              </Campo>
            </div>

            <Alerta texto={perfil.erro} />
            <Alerta texto={perfil.sucesso} tipo="ok" />

            <div className="lin-fim mt">
              <button
                className="b-primario"
                disabled={perfil.ocupado || !nomeValido}
                onClick={() =>
                  perfil.executar(async () => {
                    await api<Usuario>("PATCH", "auth/me", { nome: nome.trim() });
                    await ctx.recarregar();
                  }, "Nome atualizado. Ele aparece atualizado no próximo acesso.")
                }
              >
                {perfil.ocupado && <Girando />}Salvar nome
              </button>
            </div>
          </section>

          <section className="cartao">
            <div className="cartao-cab"><h3>Trocar senha</h3></div>

            <Campo id="s-atual" rotulo="Senha atual" obrigatorio ajuda="Confirmação de que é você.">
              <input id="s-atual" type="password" autoComplete="current-password"
                value={senhas.atual} onChange={(e) => setSenhas({ ...senhas, atual: e.target.value })} />
            </Campo>
            <div className="mt">
              <Campo id="s-nova" rotulo="Nova senha" obrigatorio ajuda="Mínimo de 6 caracteres.">
                <input id="s-nova" type="password" autoComplete="new-password"
                  value={senhas.nova} onChange={(e) => setSenhas({ ...senhas, nova: e.target.value })} />
              </Campo>
            </div>
            <div className="mt">
              <Campo
                id="s-conf" rotulo="Confirmar nova senha" obrigatorio
                erro={senhas.confirma && senhas.nova !== senhas.confirma ? "As senhas não coincidem." : null}
              >
                <input id="s-conf" type="password" autoComplete="new-password"
                  value={senhas.confirma} onChange={(e) => setSenhas({ ...senhas, confirma: e.target.value })} />
              </Campo>
            </div>

            <Alerta texto={senha.erro} />
            <Alerta texto={senha.sucesso} tipo="ok" />

            <div className="lin-fim mt">
              <button
                className="b-primario"
                disabled={senha.ocupado || !senhaValida}
                onClick={async () => {
                  const ok = await senha.executar(
                    () => api("PATCH", "auth/me", { senha: senhas.nova, senhaAtual: senhas.atual }),
                    "Senha alterada."
                  );
                  if (ok) setSenhas({ atual: "", nova: "", confirma: "" });
                }}
              >
                {senha.ocupado && <Girando />}Trocar senha
              </button>
            </div>
          </section>
        </div>

        <section className="cartao">
          <div className="cartao-cab"><h3>Encerrar conta</h3></div>
          <p className="sec">
            Excluir a conta cancela os seus pedidos e ingressos, devolve os lugares à
            venda e estorna o que foi pago. Se você organiza eventos, eles são
            cancelados e os compradores são avisados e estornados.
          </p>
          <p className="sec mt" style={{ fontSize: ".82rem" }}>
            <ShieldAlert size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            Não dá para desfazer.
          </p>

          <Alerta texto={exclusao.erro} />

          <button className="b-perigo b-bloco mt" onClick={() => setConfirmando(true)} disabled={exclusao.ocupado}>
            Excluir minha conta
          </button>
        </section>
      </div>

      {confirmando && (
        <Confirmacao
          titulo="Excluir sua conta"
          texto="Seus pedidos e ingressos são cancelados e estornados. Esta ação não pode ser desfeita."
          rotuloConfirmar="Excluir conta"
          perigo
          ocupado={exclusao.ocupado}
          aoCancelar={() => setConfirmando(false)}
          aoConfirmar={() =>
            exclusao.executar(async () => {
              await api("DELETE", `auth/usuarios/${ctx.eu.id}`);
              aoSair();
            })
          }
        />
      )}

      <p className="sec mt" style={{ fontSize: ".76rem" }}>
        <UserCircle size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
        A sessão dura 8 horas e não é renovada automaticamente: depois disso, é preciso entrar de novo.
      </p>
    </>
  );
}
