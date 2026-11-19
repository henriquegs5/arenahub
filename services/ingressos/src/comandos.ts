import { PoolClient } from "pg";
import { EventoSaida } from "./outbox";
import { estadoPedido } from "./estados";
import { emReais } from "./meios";
import * as repo from "./repositorio";

/**
 * Padrão GoF: COMMAND.
 *
 * Cada ação sobre o pedido — reservar, cobrar, aprovar, emitir, recusar,
 * expirar, cancelar — é um objeto com `executar()`. Todas passam pelo mesmo
 * executor, que:
 *
 *   1. aplica a transição do STATE (e recusa a ação se o estado não aceitar);
 *   2. grava a linha de HISTÓRICO (quem fez o quê, quando, e o estado depois);
 *   3. devolve os eventos que a Saga precisa publicar.
 *
 * O histórico sai de graça justamente porque toda ação é um comando: não há
 * caminho que mude o pedido sem passar por aqui e deixar rastro.
 */

export interface ContextoComando {
  c: PoolClient;
  pedido: repo.Pedido;
  /** Quem disparou: o próprio comprador, o ADM, ou null quando foi a Saga. */
  autorId: string | null;
  correlationId: string;
}

export interface ResultadoComando {
  /** Eventos a publicar depois do commit (via outbox). */
  eventos: EventoSaida[];
  /** Status em que o pedido ficou. */
  statusApos: string;
}

export abstract class ComandoPedido {
  /** Nome gravado no histórico. */
  abstract readonly nome: string;

  /** Dados extras do histórico. */
  dadosHistorico(_ctx: ContextoComando): Record<string, unknown> { return {}; }

  abstract executar(ctx: ContextoComando): Promise<ResultadoComando>;
}

/**
 * Executor único: roda o comando e grava o histórico na MESMA transação.
 * Nenhum comando grava histórico por conta própria.
 */
export async function executar(comando: ComandoPedido, ctx: ContextoComando): Promise<EventoSaida[]> {
  const resultado = await comando.executar(ctx);
  await repo.registrarHistorico(
    ctx.c,
    ctx.pedido.id,
    comando.nome,
    ctx.autorId,
    comando.dadosHistorico(ctx),
    resultado.statusApos
  );
  return resultado.eventos;
}

// ---------------------------------------------------------------- comandos

/** Passo 1: o pedido nasce e pede a reserva dos lugares. */
export class SolicitarCompra extends ComandoPedido {
  readonly nome = "SOLICITAR_COMPRA";

  constructor(private readonly itens: { loteId: string; quantidade: number; politica: string }[]) { super(); }

  dadosHistorico() {
    return { itens: this.itens, totalItens: this.itens.reduce((t, i) => t + i.quantidade, 0) };
  }

  async executar(ctx: ContextoComando): Promise<ResultadoComando> {
    return {
      statusApos: ctx.pedido.status,
      eventos: [{
        nome: "compra.solicitada",
        correlationId: ctx.correlationId,
        payload: {
          pedidoId: ctx.pedido.id,
          eventoId: ctx.pedido.eventoId,
          compradorId: ctx.pedido.compradorId,
          itens: this.itens,
          destinatarios: [] as string[],
        },
      }],
    };
  }
}

/** Passo 3: lugares reservados, hora de pedir a cobrança. */
export class SolicitarPagamento extends ComandoPedido {
  readonly nome = "SOLICITAR_PAGAMENTO";

  constructor(private readonly totalCentavos: number) { super(); }

  dadosHistorico(ctx: ContextoComando) {
    return { valor: emReais(this.totalCentavos), meio: ctx.pedido.meio };
  }

  async executar(ctx: ContextoComando): Promise<ResultadoComando> {
    const proximo = estadoPedido(ctx.pedido.status).cobrar();
    await repo.atualizarStatusPedido(ctx.c, ctx.pedido.id, proximo.nome);

    return {
      statusApos: proximo.nome,
      eventos: [{
        nome: "pagamento.solicitado",
        correlationId: ctx.correlationId,
        payload: {
          pedidoId: ctx.pedido.id,
          eventoId: ctx.pedido.eventoId,
          compradorId: ctx.pedido.compradorId,
          valorCentavos: this.totalCentavos,
          meio: ctx.pedido.meio,
          // Referência OPACA ao meio de pagamento; nunca dado de cartão.
          referenciaPagamento: ctx.pedido.referenciaPagamento,
          eventoNome: ctx.pedido.eventoNome ?? "evento",
          destinatarios: [] as string[],
        },
      }],
    };
  }
}

/** Passo 5: pagamento aprovado, emite os ingressos digitais. */
export class EmitirIngressos extends ComandoPedido {
  readonly nome = "EMITIR_INGRESSOS";

  constructor(private readonly autorizacao: string | null) { super(); }

  dadosHistorico() { return { autorizacao: this.autorizacao }; }

  async executar(ctx: ContextoComando): Promise<ResultadoComando> {
    const { c, pedido } = ctx;

    // Aprovado -> PAGO -> (emite) -> CONCLUIDO.
    const pago = estadoPedido(pedido.status).aprovar();
    await repo.atualizarStatusPedido(c, pedido.id, pago.nome);

    const itens = await repo.itensDoPedido(c, pedido.id);
    const emitidos: repo.Ingresso[] = [];

    // Um ingresso por lugar comprado.
    for (const item of itens) {
      for (let i = 0; i < item.quantidade; i++) {
        emitidos.push(await repo.emitirIngresso(c, {
          pedidoId: pedido.id,
          eventoId: pedido.eventoId,
          titularId: pedido.compradorId,
          organizadorId: pedido.organizadorId,
          setorNome: item.setorNome,
          loteNome: item.loteNome,
          politica: item.politica,
          precoCentavos: item.precoUnitarioCentavos,
          eventoNome: pedido.eventoNome,
          eventoDataHora: pedido.eventoDataHora,
          eventoLocal: pedido.eventoLocal,
        }));
      }
    }

    const concluido = estadoPedido(pago.nome).concluir();
    await repo.atualizarStatusPedido(c, pedido.id, concluido.nome);

    return {
      statusApos: concluido.nome,
      eventos: [{
        nome: "ingresso.emitido",
        correlationId: ctx.correlationId,
        payload: {
          pedidoId: pedido.id,
          eventoId: pedido.eventoId,
          compradorId: pedido.compradorId,
          eventoNome: pedido.eventoNome ?? "evento",
          eventoDataHora: pedido.eventoDataHora?.toISOString() ?? null,
          eventoLocal: pedido.eventoLocal ?? null,
          totalCentavos: pedido.totalCentavos,
          ingressos: emitidos.map((i) => ({
            ingressoId: i.id,
            codigo: i.codigo,
            setorNome: i.setorNome,
            loteNome: i.loteNome,
            politica: i.politica,
          })),
          // O comprador é avisado da emissão.
          destinatarios: [pedido.compradorId],
        },
      }],
    };
  }
}

/**
 * COMPENSAÇÃO. Encerra o pedido e devolve o que for preciso:
 *  - se havia lugares reservados, publica `pedido.cancelado` para Eventos liberar;
 *  - se havia cobrança aprovada, publica `estorno.solicitado` para Pagamento estornar;
 *  - se havia ingressos emitidos, eles são cancelados ou invalidados.
 *
 * É o mesmo comando para recusa de pagamento, expiração, cancelamento pelo
 * comprador e evento cancelado — muda só o status final e o motivo.
 */
export class EncerrarPedido extends ComandoPedido {
  readonly nome: string;

  constructor(
    nome: string,
    private readonly destino: "RECUSADO" | "EXPIRADO" | "CANCELADO",
    private readonly motivo: string,
    /** Invalidar (evento cancelado) em vez de cancelar os ingressos. */
    private readonly invalidarIngressos = false
  ) {
    super();
    this.nome = nome;
  }

  dadosHistorico() { return { motivo: this.motivo, destino: this.destino }; }

  async executar(ctx: ContextoComando): Promise<ResultadoComando> {
    const { c, pedido } = ctx;
    const estado = estadoPedido(pedido.status);

    // O State diz o que este pedido ainda tem pendurado.
    const precisaLiberarLugares = estado.temLugaresReservados();
    const precisaEstornar = estado.exigeEstorno();

    const proximo =
      this.destino === "RECUSADO" ? estado.recusar()
      : this.destino === "EXPIRADO" ? estado.expirar()
      : estado.cancelar();

    await repo.atualizarStatusPedido(c, pedido.id, proximo.nome, this.motivo);

    // Ingressos já emitidos deixam de valer.
    const novoStatus = this.invalidarIngressos ? "INVALIDADO" : "CANCELADO";
    for (const ingresso of await repo.ingressosDoPedido(c, pedido.id)) {
      if (ingresso.status === "EMITIDO" || ingresso.status === "UTILIZADO") {
        await repo.atualizarStatusIngresso(c, ingresso.id, novoStatus);
      }
    }

    const eventos: EventoSaida[] = [];

    if (precisaLiberarLugares) {
      const itens = await repo.itensDoPedido(c, pedido.id);
      eventos.push({
        nome: "pedido.cancelado",
        correlationId: ctx.correlationId,
        payload: {
          pedidoId: pedido.id,
          eventoId: pedido.eventoId,
          compradorId: pedido.compradorId,
          motivo: this.motivo,
          situacao: proximo.nome,
          eventoNome: pedido.eventoNome ?? "evento",
          itens: itens.map((i) => ({ loteId: i.loteId, quantidade: i.quantidade })),
          // O comprador precisa saber que o pedido não foi adiante.
          destinatarios: [pedido.compradorId],
        },
      });
    }

    if (precisaEstornar) {
      eventos.push({
        nome: "estorno.solicitado",
        correlationId: ctx.correlationId,
        payload: {
          pedidoId: pedido.id,
          eventoId: pedido.eventoId,
          compradorId: pedido.compradorId,
          motivo: this.motivo,
          eventoNome: pedido.eventoNome ?? "evento",
          destinatarios: [] as string[],
        },
      });
    }

    return { statusApos: proximo.nome, eventos };
  }
}

/** Atalhos com o nome certo no histórico. */
export const recusarPorPagamento = (motivo: string) =>
  new EncerrarPedido("RECUSAR_PAGAMENTO", "RECUSADO", motivo);

export const recusarPorReserva = (motivo: string) =>
  new EncerrarPedido("RECUSAR_RESERVA", "RECUSADO", motivo);

export const expirarPedido = (motivo: string) =>
  new EncerrarPedido("EXPIRAR", "EXPIRADO", motivo);

export const cancelarPedido = (motivo: string) =>
  new EncerrarPedido("CANCELAR", "CANCELADO", motivo);

export const cancelarPorEventoCancelado = (motivo: string) =>
  new EncerrarPedido("CANCELAR_EVENTO_CANCELADO", "CANCELADO", motivo, true);

/** Validação do ingresso na entrada (check-in). Registrada no histórico do pedido. */
export class ValidarEntrada extends ComandoPedido {
  readonly nome = "VALIDAR_ENTRADA";

  constructor(private readonly ingresso: repo.Ingresso) { super(); }

  dadosHistorico() {
    return { ingressoId: this.ingresso.id, codigo: this.ingresso.codigo };
  }

  async executar(ctx: ContextoComando): Promise<ResultadoComando> {
    return { statusApos: ctx.pedido.status, eventos: [] };
  }
}
