import { useState } from "react";
import { api } from "../api";
import { Papel, Usuario } from "../types";
import { Alerta, Girando } from "../components/ui";
import logo from "../assets/logo-arenahub.png";

export interface Sessao { token: string; usuario: Usuario }

/**
 * Cadastro e login. Ambos são atendidos pelo próprio Gateway (/api/auth/*), que
 * emite e valida o JWT — a autenticação não é um dos quatro microsserviços.
 */
export function Login({ aoEntrar }: { aoEntrar: (s: Sessao) => void }) {
  const [cadastro, setCadastro] = useState(false);
  const [f, setF] = useState({ nome: "", email: "", senha: "", papel: "PARTICIPANTE" as Papel });
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const enviar = async () => {
    setErro(null); setCarregando(true);
    try {
      if (cadastro) await api("POST", "auth/register", f);
      aoEntrar(await api<Sessao>("POST", "auth/login", { email: f.email, senha: f.senha }));
    } catch (e) {
      setErro((e as Error).message);
      setCarregando(false);
    }
  };

  const campo = (k: "nome" | "email" | "senha") => ({
    value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }),
  });

  return (
    <div className="entrar">
      <div className="entrar-caixa">
        <div className="marca">
          {/* O logotipo já traz o nome da marca; o texto ao lado seria repetição. */}
          <img className="marca-logo g" src={logo} alt="ArenaHub" width={224} height={87} />
        </div>
        <p className="lema">Encontre campeonatos, convenções e encontros gamer — e garanta seu ingresso.</p>

        <form className="cartao" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
          <h3 className="mb">{cadastro ? "Criar conta" : "Entrar"}</h3>
          {cadastro && (
            <div className="campo">
              <label htmlFor="nome">Nome</label>
              <input id="nome" autoComplete="name" placeholder="Como você aparece para os outros" {...campo("nome")} />
            </div>
          )}
          <div className="campo">
            <label htmlFor="email">E-mail</label>
            <input id="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" {...campo("email")} />
          </div>
          <div className="campo">
            <label htmlFor="senha">Senha</label>
            <input id="senha" type="password" autoComplete={cadastro ? "new-password" : "current-password"} placeholder="Mínimo de 6 caracteres" {...campo("senha")} />
          </div>
          {cadastro && (
            <div className="campo">
              <label htmlFor="papel">Perfil</label>
              <select id="papel" value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value as Papel })}>
                <option value="PARTICIPANTE">Participante — compra ingressos e acompanha seus pedidos</option>
                <option value="ORGANIZADOR">Organizador — cria eventos e valida ingressos na entrada</option>
              </select>
              <small className="ajuda">O perfil de administrador não é criado por aqui.</small>
            </div>
          )}
          <Alerta texto={erro} />
          <button type="submit" className="b-primario b-bloco" disabled={carregando}>
            {carregando && <Girando />}{cadastro ? "Criar conta e entrar" : "Entrar"}
          </button>
        </form>

        <p className="troca">
          {cadastro ? "Já tem uma conta?" : "Ainda não tem conta?"}
          <button className="b-fantasma b-pequeno" onClick={() => { setCadastro(!cadastro); setErro(null); }}>
            {cadastro ? "Entrar" : "Criar conta"}
          </button>
        </p>
      </div>
    </div>
  );
}
