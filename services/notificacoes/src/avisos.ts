import { EventEnvelope } from "./messaging";
import { Aviso } from "./canais";

/**
 * Traduz um evento de domínio em UM OU MAIS avisos legíveis — um por destinatário.
 *
 * Regra do projeto: a lista de destinatários (`payload.destinatarios`) e os nomes
 * legíveis vêm no próprio payload. Este serviço NÃO consulta Eventos, Ingressos
 * nem o Gateway para descobrir quem avisar ou como se chama alguma coisa.
 *
 * Lista vazia = evento sem aviso.
 */
export function montarAvisos(e: EventEnvelope<any>): Aviso[] {
  const p = e.payload ?? {};
  const destinatarios: string[] = Array.isArray(p.destinatarios) ? p.destinatarios : [];
  if (destinatarios.length === 0) return [];

  const base = {
    usuarioId: null as string | null,
    eventoId: (p.eventoId as string) ?? null,
    pedidoId: (p.pedidoId as string) ?? null,
    ingressoId: (p.ingressoId as string) ?? null,
    dados: p as Record<string, unknown>,
    email: null as string | null,
    ocorridoEm: e.occurredAt ?? null,
  };

  const modelo = conteudo(e);
  if (!modelo) return [];

  return destinatarios.map((usuarioId) => ({
    ...base,
    ...modelo,
    usuarioId,
    // O e-mail só acompanha o aviso do próprio dono da conta.
    email: usuarioId === p.usuarioId ? (p.email as string) ?? null : null,
  }));
}

/** Título, texto e tipo de cada evento conhecido. null = evento sem aviso. */
function conteudo(e: EventEnvelope<any>): Pick<Aviso, "tipo" | "titulo" | "mensagem"> | null {
  const p = e.payload ?? {};
  switch (e.type) {
    case "usuario.registrado":
      return {
        tipo: "USUARIO_REGISTRADO",
        titulo: "Bem-vindo ao ArenaHub",
        mensagem: `Olá, ${p.nome}! Sua conta de ${rotuloPapel(p.papel)} foi criada. ` +
          "Explore os eventos e garanta seu ingresso.",
      };
    case "usuario.atualizado":
      return {
        tipo: "USUARIO_ATUALIZADO",
        titulo: "Conta atualizada",
        mensagem: `Os dados da sua conta foram alterados. Perfil atual: ${rotuloPapel(p.papel)}.`,
      };
    default:
      return null;
  }
}

const rotuloPapel = (papel: unknown): string =>
  papel === "ADM" ? "administrador"
    : papel === "ORGANIZADOR" ? "organizador"
    : "participante";
