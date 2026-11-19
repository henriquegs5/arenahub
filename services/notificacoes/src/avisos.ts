import { EventEnvelope } from "./messaging";
import { Aviso } from "./canais";

/**
 * Traduz um evento de domínio em UM OU MAIS avisos legíveis — um por destinatário.
 *
 * Regra do projeto: a lista de destinatários (`payload.destinatarios`) e os nomes
 * legíveis (nome do evento, do setor, do lote) vêm no PRÓPRIO payload. Este
 * serviço NÃO consulta Eventos, Ingressos, Pagamento nem o Gateway para descobrir
 * quem avisar ou como se chama alguma coisa — isso acoplaria os serviços.
 *
 * Lista vazia = evento sem aviso.
 */
export function montarAvisos(e: EventEnvelope<any>): Aviso[] {
  const p = e.payload ?? {};
  const destinatarios: string[] = Array.isArray(p.destinatarios) ? p.destinatarios : [];
  if (destinatarios.length === 0) return [];

  const modelo = conteudo(e);
  if (!modelo) return [];

  const base = {
    usuarioId: null as string | null,
    eventoId: (p.eventoId as string) ?? null,
    pedidoId: (p.pedidoId as string) ?? null,
    ingressoId: null as string | null,
    dados: p as Record<string, unknown>,
    email: null as string | null,
    ocorridoEm: e.occurredAt ?? null,
  };

  return destinatarios.map((usuarioId) => ({
    ...base,
    ...modelo,
    usuarioId,
    // O e-mail só acompanha o aviso do próprio dono da conta.
    email: usuarioId === p.usuarioId ? (p.email as string) ?? null : null,
  }));
}

const emReais = (centavos: unknown): string =>
  typeof centavos === "number"
    ? (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";

const quandoEOnde = (p: any): string => {
  const partes: string[] = [];
  if (p.eventoDataHora) {
    const d = new Date(p.eventoDataHora);
    if (!Number.isNaN(d.getTime()))
      partes.push(d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }));
  }
  if (p.eventoLocal) partes.push(String(p.eventoLocal));
  return partes.length ? ` ${partes.join(" · ")}.` : "";
};

/** Título, texto e tipo de cada evento conhecido. null = evento sem aviso. */
function conteudo(e: EventEnvelope<any>): Pick<Aviso, "tipo" | "titulo" | "mensagem"> | null {
  const p = e.payload ?? {};

  switch (e.type) {
    // ---------- conta ----------
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

    // ---------- compra ----------
    case "ingresso.emitido": {
      const n = Array.isArray(p.ingressos) ? p.ingressos.length : 0;
      const codigos = Array.isArray(p.ingressos)
        ? p.ingressos.map((i: any) => i.codigo).filter(Boolean).join(", ")
        : "";
      return {
        tipo: "INGRESSO_EMITIDO",
        titulo: n === 1 ? "Ingresso emitido" : `${n} ingressos emitidos`,
        mensagem:
          `Compra confirmada para "${p.eventoNome}".${quandoEOnde(p)} ` +
          `${n === 1 ? "Código" : "Códigos"}: ${codigos || "disponível em Meus ingressos"}. ` +
          `Total: ${emReais(p.totalCentavos)}.`,
      };
    }

    case "pagamento.recusado":
      return {
        tipo: "PAGAMENTO_RECUSADO",
        titulo: "Pagamento recusado",
        mensagem:
          `O pagamento de ${emReais(p.valorCentavos)} para "${p.eventoNome ?? "o evento"}" não foi autorizado. ` +
          `Motivo: ${p.motivo ?? "não informado"}. Os lugares foram liberados e o pedido, cancelado.`,
      };

    case "pedido.cancelado":
      return {
        tipo: "PEDIDO_CANCELADO",
        titulo: tituloPedidoCancelado(p.situacao),
        mensagem:
          `Seu pedido para "${p.eventoNome ?? "o evento"}" foi encerrado. ` +
          `Motivo: ${p.motivo ?? "não informado"}.`,
      };

    case "estorno.concluido":
      return {
        tipo: "ESTORNO_CONCLUIDO",
        titulo: p.automatico === false ? "Estorno em processamento" : "Estorno concluído",
        mensagem: p.automatico === false
          ? `O reembolso de ${emReais(p.valorCentavos)} de "${p.eventoNome ?? "o evento"}" será feito ` +
            `manualmente. Motivo: ${p.motivo ?? "não informado"}.`
          : `${emReais(p.valorCentavos)} de "${p.eventoNome ?? "o evento"}" foram estornados. ` +
            `Motivo: ${p.motivo ?? "não informado"}.`,
      };

    // ---------- atualização de última hora ----------
    case "ingressos.afetados": {
      const mudou = Array.isArray(p.alteracoes) ? p.alteracoes : [];
      return {
        tipo: "EVENTO_ALTERADO",
        titulo: "Mudança no seu evento",
        mensagem:
          `"${p.eventoNome}" teve ${listar(mudou.map(rotuloAlteracao))} alterado${mudou.length > 1 ? "s" : ""}. ` +
          `Agora é${quandoEOnde({ eventoDataHora: p.dataHora, eventoLocal: p.local })} ` +
          "Seu ingresso continua válido.",
      };
    }

    default:
      return null;
  }
}

const tituloPedidoCancelado = (situacao: unknown): string =>
  situacao === "EXPIRADO" ? "Pedido expirado"
    : situacao === "RECUSADO" ? "Pedido não concluído"
    : "Pedido cancelado";

const rotuloPapel = (papel: unknown): string =>
  papel === "ADM" ? "administrador"
    : papel === "ORGANIZADOR" ? "organizador"
    : "participante";

const rotuloAlteracao = (a: string): string =>
  a === "data" ? "a data" : a === "local" ? "o local" : "o nome";

/** "a data", "a data e o local", "a data, o local e o nome". */
function listar(itens: string[]): string {
  if (itens.length === 0) return "informações";
  if (itens.length === 1) return itens[0];
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}
