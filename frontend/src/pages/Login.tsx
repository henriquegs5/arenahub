import { useState } from "react";
import { Gamepad2 } from "lucide-react";
import { api } from "../api";
import { Papel, Usuario } from "../types";
import { Alerta, Girando } from "../components/ui";

export interface Sessao { token: string; usuario: Usuario }

export function Login({ aoEntrar }: { aoEntrar: (s: Sessao) => void }) {
  const [cadastro, setCadastro] = useState(false);
  const [f, setF] = useState({ nome: "", email: "", senha: "", papel: "JOGADOR" as Papel });
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const enviar = async () => {
    setErro(null); setCarregando(true);
    try {
      if (cadastro) await api("POST", "identidade/register", f);
      aoEntrar(await api<Sessao>("POST", "identidade/login", { email: f.email, senha: f.senha }));
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
          <span className="marca-icone"><Gamepad2 size={18} /></span>
          <div><b>ArenaHub</b><span>Campeonatos de e-sports</span></div>
        </div>
        <p className="lema">Organize campeonatos, monte sua equipe e acompanhe a classificação.</p>

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
                <option value="JOGADOR">Jogador — monta equipe e disputa torneios</option>
                <option value="ORGANIZADOR">Organizador — cria e conduz torneios</option>
              </select>
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
