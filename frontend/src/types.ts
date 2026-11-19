/**
 * Perfis da plataforma. O backend é a autoridade: esconder um botão nunca é
 * controle de acesso, apenas evita oferecer o que vai ser recusado.
 */
export type Papel = "PARTICIPANTE" | "ORGANIZADOR" | "ADM";

export const ROTULO_PAPEL: Record<Papel, string> = {
  PARTICIPANTE: "Participante",
  ORGANIZADOR: "Organizador",
  ADM: "Administrador",
};

export interface Usuario { id: string; nome: string; papel: Papel; email?: string }

export interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  usuarioId: string | null;
  eventoId: string | null;
  pedidoId: string | null;
  ingressoId: string | null;
  criadoEm: string;
}

export interface StatusServico { servico: string; circuito: string }

/** Dados e utilidades compartilhados por todas as telas. */
export interface Ctx {
  eu: Usuario;
  usuarios: Usuario[];
  nomeUsuario: (id?: string | null) => string;
  recarregar: () => Promise<void>;
}
