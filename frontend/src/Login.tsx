import { useState } from "react";
import { api } from "./api";
import { Papel, Usuario } from "./types";
import { Alerta } from "./ui";

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
      const r = await api<Sessao>("POST", "identidade/login", { email: f.email, senha: f.senha });
      aoEntrar(r);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="login">
      <h1>🎮 ArenaHub</h1>
      <p className="sub">Plataforma de campeonatos de e-sports</p>
      <div className="card">
        <h3>{cadastro ? "Criar conta" : "Entrar"}</h3>
        {cadastro && (
          <label>Nome<input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></label>
        )}
        <label>E-mail<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Senha<input type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} /></label>
        {cadastro && (
          <label>Perfil
            <select value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value as Papel })}>
              <option value="JOGADOR">Jogador</option>
              <option value="ORGANIZADOR">Organizador</option>
            </select>
          </label>
        )}
        <Alerta texto={erro} />
        <button disabled={carregando} onClick={enviar}>{cadastro ? "Cadastrar e entrar" : "Entrar"}</button>
        <button className="link" onClick={() => { setCadastro(!cadastro); setErro(null); }}>
          {cadastro ? "Já tenho conta" : "Criar uma conta"}
        </button>
      </div>
    </div>
  );
}
