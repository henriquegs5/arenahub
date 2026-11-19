import { PoolClient } from "pg";
import { Autor } from "./auth";
import { pool } from "./db";
import { PEDIDO_EXPIRA_SEGUNDOS } from "./config";
import { estadoIngresso, estadoPedido } from "./estados";
import { EventEnvelope } from "./messaging";
import { EventoSaida, transacao, transacaoCom } from "./outbox";
import * as cmd from "./comandos";
import * as repo from "./repositorio";
import { ContextoCompra, cadeiaDeCompra } from "./validacoes";

export class ErroNegocio extends Error {
  constructor(public readonly status: number, mensagem: string) {
    super(mensagem);
    this.name = "ErroNegocio";
  }
}

// ======================================================= início da compra

export interface DadosCompra {
  eventoId: string;
  itens: { loteId: string; quantidade: number; politica: string }[];
  meio: string;
  referenciaPagamento: string;
}

/**
 * Passo 1 da SAGA DA COMPRA.
 *
 * Cria o pedido PENDENTE e publica `compra.solicitada`. A resposta HTTP é 202:
 * daqui para a frente tudo acontece por eventos, e o comprador acompanha o
 * pedido mudando de estado.
 */
export async function solicitarCompra(d: DadosCompra, autor: Autor, correlationId: string): Promise<repo.Pedido> {
  return transacaoCom(async (c) => {
    // CHAIN OF RESPONSIBILITY: o que este serviço pode validar com dados próprios.
    const ctx: ContextoCompra = {
      autor,
      eventoId: d.eventoId,
      itens: d.itens,
      meio: d.meio,
      referenciaPagamento: d.referenciaPagamento,
      jaPedidos: await repo.quantidadeJaPedida(c, d.eventoId, autor.id),
      pedidoEmAndamento: await repo.temPedidoEmAndamento(c, d.eventoId, autor.id),
    };

    const recusa = cadeiaDeCompra().verificar(ctx);
    if (recusa) throw new ErroNegocio(recusa.status, recusa.mensagem);

    const pedido = await repo.criarPedido(c, {
      eventoId: d.eventoId,
      compradorId: autor.id,
      meio: d.meio,
      referenciaPagamento: d.referenciaPagamento.trim(),
      expiraEm: new Date(Date.now() + PEDIDO_EXPIRA_SEGUNDOS * 1000),
      itens: d.itens,
    });

    const eventos = await cmd.executar(
      new cmd.SolicitarCompra(d.itens),
      { c, pedido, autorId: autor.id, correlationId }
    );

    return { valor: pedido, eventos };
  });
}

// ======================================================= reações da Saga

async function idempotente(evento: EventEnvelope, fn: () => Promise<void>): Promise<void> {
  if (!(await repo.marcarProcessado(evento.eventId))) return;
  try {
    await fn();
  } catch (e) {
    await repo.desmarcarProcessado(evento.eventId);
    throw e;
  }
}

/**
 * Roda um comando sobre um pedido, em transação, com o histórico.
 * Devolve false quando o pedido sumiu ou o estado não aceita mais a ação —
 * o que é normal numa Saga: a compensação pode chegar depois do desfecho.
 */
async function aplicar(
  pedidoId: string,
  comando: cmd.ComandoPedido,
  autorId: string | null,
  correlationId: string,
  aceita: (status: string) => boolean
): Promise<boolean> {
  let aplicou = false;
  await transacao(async (c: PoolClient) => {
    const pedido = await repo.buscarPedido(c, pedidoId, true);
    if (!pedido) {
      console.log(`[ingressos] pedido ${pedidoId} não encontrado; nada a fazer`);
      return [];
    }
    if (!aceita(pedido.status)) {
      console.log(`[ingressos] pedido ${pedidoId} está ${pedido.status}; comando ${comando.nome} ignorado`);
      return [];
    }
    const eventos = await cmd.executar(comando, { c, pedido, autorId, correlationId });
    aplicou = true;
    return eventos;
  });
  return aplicou;
}

/** Pedido que já terminou sem concluir: a Saga não anda mais para a frente. */
const ENCERRADO_SEM_CONCLUIR = ["CANCELADO", "EXPIRADO", "RECUSADO"];

interface PayloadLugaresReservados {
  pedidoId: string;
  organizadorId?: string | null;
  totalCentavos: number;
  eventoNome: string;
  eventoDataHora: string;
  eventoLocal: string;
  itens: { loteId: string; setorNome: string; loteNome: string; precoUnitarioCentavos: number }[];
}

/** Passo 3: lugares reservados → grava os dados e pede a cobrança. */
export function tratarLugaresReservados(evento: EventEnvelope<PayloadLugaresReservados>) {
  return idempotente(evento, async () => {
    const p = evento.payload;

    await transacao(async (c) => {
      const pedido = await repo.buscarPedido(c, p.pedidoId, true);

      /**
       * COMPENSAÇÃO DA RESERVA TARDIA. O pedido pode ter sido cancelado ou ter
       * expirado ainda PENDENTE — e nesse caso nenhum `pedido.cancelado` saiu,
       * porque ainda não havia lugares reservados. Se a reserva chega DEPOIS,
       * ninguém mais a reclama e ela ficaria ATIVA para sempre, prendendo lugares
       * de um pedido morto. Aqui devolvemos o que acabou de ser reservado.
       */
      if (pedido && ENCERRADO_SEM_CONCLUIR.includes(pedido.status)) {
        console.log(`[ingressos] reserva do pedido ${p.pedidoId} chegou com o pedido ${pedido.status}; devolvendo os lugares`);
        const itens = await repo.itensDoPedido(c, pedido.id);
        await repo.registrarHistorico(c, pedido.id, "DEVOLVER_RESERVA_TARDIA", null,
          { motivo: "a reserva chegou depois do encerramento do pedido" }, pedido.status);
        return [{
          nome: "pedido.cancelado",
          correlationId: evento.correlationId,
          payload: {
            pedidoId: pedido.id,
            eventoId: pedido.eventoId,
            compradorId: pedido.compradorId,
            motivo: "a reserva chegou depois do encerramento do pedido",
            situacao: pedido.status,
            eventoNome: p.eventoNome,
            itens: itens.map((i) => ({ loteId: i.loteId, quantidade: i.quantidade })),
            // O comprador já foi avisado quando o pedido foi encerrado.
            destinatarios: [] as string[],
          },
        }] as EventoSaida[];
      }

      if (!pedido || pedido.status !== "PENDENTE") {
        console.log(`[ingressos] pedido ${p.pedidoId} não está PENDENTE; reserva ignorada`);
        return [];
      }

      // Nomes legíveis e preços vêm no evento: este serviço não consulta Eventos.
      await repo.aplicarReserva(c, p.pedidoId, p);
      await repo.atualizarStatusPedido(c, p.pedidoId, estadoPedido(pedido.status).reservar().nome);
      await repo.registrarHistorico(c, p.pedidoId, "RESERVAR_LUGARES", null,
        { totalCentavos: p.totalCentavos }, "RESERVADO");

      const atualizado = (await repo.buscarPedido(c, p.pedidoId))!;
      return cmd.executar(
        new cmd.SolicitarPagamento(p.totalCentavos),
        { c, pedido: atualizado, autorId: null, correlationId: evento.correlationId }
      );
    });
  });
}

/** COMPENSAÇÃO: a reserva foi recusada, o pedido morre aqui. */
export function tratarReservaRecusada(evento: EventEnvelope<{ pedidoId: string; motivo: string }>) {
  return idempotente(evento, async () => {
    const { pedidoId, motivo } = evento.payload;
    await aplicar(
      pedidoId,
      cmd.recusarPorReserva(motivo),
      null,
      evento.correlationId,
      (s) => s === "PENDENTE"
    );
  });
}

/** Passo 5: pagamento aprovado → emite os ingressos. */
export function tratarPagamentoAprovado(
  evento: EventEnvelope<{ pedidoId: string; autorizacao: string | null; valorCentavos?: number }>
) {
  return idempotente(evento, async () => {
    const { pedidoId, autorizacao } = evento.payload;

    await transacao(async (c: PoolClient) => {
      const pedido = await repo.buscarPedido(c, pedidoId, true);
      if (!pedido) {
        console.log(`[ingressos] pagamento aprovado para pedido inexistente ${pedidoId}; ignorado`);
        return [];
      }

      if (pedido.status === "AGUARDANDO_PAGAMENTO") {
        return cmd.executar(
          new cmd.EmitirIngressos(autorizacao),
          { c, pedido, autorId: null, correlationId: evento.correlationId }
        );
      }

      /**
       * COBRANÇA SEM INGRESSO. O pagamento foi aprovado, mas o pedido já tinha
       * acabado: expirou com o serviço de Pagamento fora do ar, ou o comprador o
       * cancelou enquanto a cobrança corria. Ignorar o evento deixaria o cliente
       * cobrado, sem ingresso e sem estorno. O dinheiro entrou, então devolve.
       *
       * Idempotente: Pagamento só estorna uma transação ainda APROVADA.
       */
      if (ENCERRADO_SEM_CONCLUIR.includes(pedido.status)) {
        console.log(`[ingressos] pagamento aprovado chegou com o pedido ${pedido.status}; pedindo estorno`);
        await repo.registrarHistorico(c, pedido.id, "ESTORNAR_PAGAMENTO_TARDIO", null,
          { motivo: "pagamento aprovado depois do encerramento do pedido", autorizacao }, pedido.status);
        return [{
          nome: "estorno.solicitado",
          correlationId: evento.correlationId,
          payload: {
            pedidoId: pedido.id,
            eventoId: pedido.eventoId,
            compradorId: pedido.compradorId,
            motivo: "o pagamento foi aprovado depois de o pedido ter sido encerrado",
            eventoNome: pedido.eventoNome ?? "evento",
            destinatarios: [] as string[],
          },
        }] as EventoSaida[];
      }

      console.log(`[ingressos] pedido ${pedidoId} está ${pedido.status}; pagamento aprovado ignorado`);
      return [];
    });
  });
}

/** COMPENSAÇÃO: pagamento recusado → encerra o pedido e libera os lugares. */
export function tratarPagamentoRecusado(evento: EventEnvelope<{ pedidoId: string; motivo: string }>) {
  return idempotente(evento, async () => {
    const { pedidoId, motivo } = evento.payload;
    await aplicar(
      pedidoId,
      cmd.recusarPorPagamento(motivo),
      null,
      evento.correlationId,
      (s) => s === "AGUARDANDO_PAGAMENTO" || s === "RESERVADO"
    );
  });
}

/** Registra no histórico que o estorno saiu. */
export function tratarEstornoConcluido(
  evento: EventEnvelope<{ pedidoId: string; valorCentavos: number; automatico: boolean; motivo: string }>
) {
  return idempotente(evento, () => transacao(async (c) => {
    const p = evento.payload;
    const pedido = await repo.buscarPedido(c, p.pedidoId, true);
    if (!pedido) return [];
    await repo.registrarHistorico(c, p.pedidoId, "ESTORNO_CONCLUIDO", null,
      { valorCentavos: p.valorCentavos, automatico: p.automatico, motivo: p.motivo }, pedido.status);
    return [];
  }));
}

/**
 * Evento cancelado: cancela TODOS os pedidos vivos dele, o que invalida os
 * ingressos, libera os lugares e dispara o estorno de quem já tinha pago.
 */
export function tratarEventoCancelado(evento: EventEnvelope<{ eventoId: string; nome: string; motivo: string }>) {
  return idempotente(evento, async () => {
    const { eventoId, nome, motivo } = evento.payload;
    const razao = `o evento "${nome}" foi cancelado: ${motivo}`;

    const pedidos = await repo.listarPedidos({ compradorId: null, eventoId, limite: 500 });
    let n = 0;
    for (const p of pedidos) {
      const aplicou = await aplicar(
        p.id,
        cmd.cancelarPorEventoCancelado(razao),
        null,
        evento.correlationId,
        (s) => !["CANCELADO", "EXPIRADO", "RECUSADO"].includes(s)
      );
      if (aplicou) n++;
    }
    if (n) console.log(`[ingressos] evento ${eventoId} cancelado: ${n} pedido(s) encerrado(s)`);
  });
}

/**
 * Evento alterado (data, local ou nome): atualiza a cópia local e avisa QUEM
 * COMPROU. É aqui que a "atualização de última hora" ganha destinatários — o
 * serviço de Eventos não sabe quem comprou, este sabe.
 */
export function tratarEventoAlterado(
  evento: EventEnvelope<{
    eventoId: string; nome: string; dataHora: string; local: string; alteracoes: string[];
  }>
) {
  return idempotente(evento, () => transacao(async (c) => {
    const p = evento.payload;

    await c.query(
      `UPDATE pedidos SET evento_nome = $2, evento_data_hora = $3, evento_local = $4
        WHERE evento_id = $1`,
      [p.eventoId, p.nome, p.dataHora, p.local]
    );
    await c.query(
      `UPDATE ingressos SET evento_nome = $2, evento_data_hora = $3, evento_local = $4
        WHERE evento_id = $1`,
      [p.eventoId, p.nome, p.dataHora, p.local]
    );

    // Destinatários: todo mundo com ingresso válido deste evento.
    const titulares = await c.query(
      `SELECT DISTINCT titular_id FROM ingressos
        WHERE evento_id = $1 AND status IN ('EMITIDO','UTILIZADO')`,
      [p.eventoId]
    );
    const destinatarios = titulares.rows.map((r: any) => r.titular_id as string);
    if (destinatarios.length === 0) return [];

    console.log(`[ingressos] evento ${p.eventoId} alterado; avisando ${destinatarios.length} comprador(es)`);

    return [{
      nome: "ingressos.afetados",
      correlationId: evento.correlationId,
      payload: {
        eventoId: p.eventoId,
        eventoNome: p.nome,
        dataHora: p.dataHora,
        local: p.local,
        alteracoes: p.alteracoes,
        quantidadeTitulares: destinatarios.length,
        destinatarios,
      },
    }] as EventoSaida[];
  }));
}

/** Conta removida: cancela os pedidos e ingressos do titular. */
export function tratarUsuarioRemovido(evento: EventEnvelope<{ usuarioId: string }>) {
  return idempotente(evento, async () => {
    const { usuarioId } = evento.payload;
    const pedidos = await repo.listarPedidos({ compradorId: usuarioId, limite: 500 });
    for (const p of pedidos) {
      await aplicar(
        p.id,
        cmd.cancelarPedido("o titular encerrou a conta"),
        null,
        evento.correlationId,
        (s) => !["CANCELADO", "EXPIRADO", "RECUSADO"].includes(s)
      );
    }
  });
}

// ======================================================= expiração

/**
 * VARREDOR DE EXPIRAÇÃO — a saída para o pedido que trava.
 *
 * Um pedido pode ficar preso porque uma resposta da Saga se perdeu, ou porque o
 * serviço de Pagamento está fora do ar. Sem saída, os lugares ficariam
 * reservados para sempre e o evento esgotaria sem ter vendido.
 *
 * Este varredor roda dentro do PRÓPRIO serviço de Ingressos e não depende de
 * ninguém: mesmo com Pagamento parado, o pedido expira, publica
 * `pedido.cancelado` e o serviço de Eventos devolve os lugares ao estoque.
 *
 * `FOR UPDATE SKIP LOCKED` permite rodar várias réplicas sem pegar o mesmo
 * pedido duas vezes. Pedidos PAGO ficam de fora: dinheiro que entrou se
 * resolve concluindo a emissão, nunca expirando.
 */
export async function varrerExpirados(): Promise<number> {
  let expirados = 0;

  const pedidos = await (async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const lista = await repo.pedidosExpirados(c, 50);
      await c.query("COMMIT");
      return lista;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  })();

  for (const p of pedidos) {
    const minutos = Math.round(PEDIDO_EXPIRA_SEGUNDOS / 60);
    const aplicou = await aplicar(
      p.id,
      cmd.expirarPedido(
        `o pedido não foi concluído em ${minutos >= 1 ? `${minutos} min` : `${PEDIDO_EXPIRA_SEGUNDOS}s`} e expirou`
      ),
      null,
      `expiracao-${p.id}`,
      (s) => ["PENDENTE", "RESERVADO", "AGUARDANDO_PAGAMENTO"].includes(s)
    );
    if (aplicou) {
      expirados++;
      console.log(`[ingressos] pedido ${p.id} expirou; lugares serão liberados pela compensação`);
    }
  }

  return expirados;
}

export function iniciarVarredor(ms = Number(process.env.EXPIRACAO_INTERVALO_MS ?? 15000)): NodeJS.Timeout {
  return setInterval(() => {
    varrerExpirados().catch((e) => console.error("[ingressos] varredor de expiração falhou", e));
  }, ms);
}

// ======================================================= ações do comprador

/** Cancelamento pelo comprador (ou pelo ADM). */
export async function cancelar(pedidoId: string, autor: Autor, motivo: string, correlationId: string): Promise<void> {
  const pedido = await repo.buscarPedido(pool, pedidoId);
  if (!pedido) throw new ErroNegocio(404, "pedido não encontrado");
  if (autor.papel !== "ADM" && pedido.compradorId !== autor.id)
    throw new ErroNegocio(403, "você só pode cancelar os seus próprios pedidos");

  if (!estadoPedido(pedido.status).aceitaCancelamento())
    throw new ErroNegocio(409, `um pedido em ${pedido.status} não pode ser cancelado`);

  const aplicou = await aplicar(
    pedidoId,
    cmd.cancelarPedido(motivo || "cancelado pelo comprador"),
    autor.id,
    correlationId,
    (s) => estadoPedido(s as never).aceitaCancelamento()
  );
  if (!aplicou) throw new ErroNegocio(409, "o pedido mudou de situação; recarregue e tente de novo");
}

/** Cancelamento de UM ingresso. O pedido inteiro só cai se não sobrar nenhum. */
export async function cancelarIngresso(
  ingressoId: string, autor: Autor, correlationId: string
): Promise<repo.Ingresso> {
  return transacaoCom(async (c) => {
    const ingresso = await repo.buscarIngresso(c, ingressoId, true);
    if (!ingresso) throw new ErroNegocio(404, "ingresso não encontrado");
    if (autor.papel !== "ADM" && ingresso.titularId !== autor.id)
      throw new ErroNegocio(403, "você só pode cancelar os seus próprios ingressos");
    if (ingresso.status !== "EMITIDO")
      throw new ErroNegocio(409, estadoIngresso(ingresso.status).motivoRecusa());

    await repo.atualizarStatusIngresso(c, ingressoId, estadoIngresso(ingresso.status).cancelar().nome);

    const pedido = await repo.buscarPedido(c, ingresso.pedidoId, true);
    const eventos: EventoSaida[] = [];

    if (pedido) {
      await repo.registrarHistorico(c, pedido.id, "CANCELAR_INGRESSO", autor.id,
        { ingressoId, codigo: ingresso.codigo }, pedido.status);

      // Sobrou algum ingresso válido? Se não, o pedido inteiro é encerrado.
      const restantes = (await repo.ingressosDoPedido(c, pedido.id))
        .filter((i) => i.status === "EMITIDO" || i.status === "UTILIZADO");

      if (restantes.length === 0 && estadoPedido(pedido.status).aceitaCancelamento()) {
        eventos.push(...await cmd.executar(
          cmd.cancelarPedido("todos os ingressos do pedido foram cancelados"),
          { c, pedido, autorId: autor.id, correlationId }
        ));
      }
    }

    return { valor: (await repo.buscarIngresso(c, ingressoId))!, eventos };
  });
}

// ======================================================= check-in

export interface ResultadoValidacao {
  aprovado: boolean;
  motivo: string | null;
  ingresso: repo.Ingresso | null;
}

/**
 * Validação do ingresso na entrada.
 *
 * O UPDATE condicional (`status = 'EMITIDO'`) é o que impede a entrada dupla:
 * duas leituras do mesmo QR ao mesmo tempo não passam as duas. A segunda recebe
 * a recusa com o motivo, não um erro genérico.
 */
export async function validarEntrada(
  codigo: string, autor: Autor, correlationId: string
): Promise<ResultadoValidacao> {
  const ingresso = await repo.buscarIngressoPorCodigo(pool, codigo);
  if (!ingresso) return { aprovado: false, motivo: "código não encontrado", ingresso: null };

  // Só o organizador DO EVENTO (ou o ADM) valida. O dono do evento vem copiado no
  // ingresso (`lugares.reservados`), então não é preciso consultar Eventos.
  if (autor.papel === "PARTICIPANTE")
    throw new ErroNegocio(403, "somente o organizador do evento valida ingressos na entrada");

  if (autor.papel === "ORGANIZADOR" && ingresso.organizadorId !== autor.id) {
    // Não devolve o ingresso: não se revelam dados de um evento que não é dele.
    return { aprovado: false, motivo: "este ingresso é de um evento de outro organizador", ingresso: null };
  }

  if (ingresso.status !== "EMITIDO") {
    return { aprovado: false, motivo: estadoIngresso(ingresso.status).motivoRecusa(), ingresso };
  }

  const ok = await repo.registrarEntrada(pool, ingresso.id, autor.id);
  if (!ok) {
    const atual = await repo.buscarIngresso(pool, ingresso.id);
    return {
      aprovado: false,
      motivo: atual ? estadoIngresso(atual.status).motivoRecusa() : "ingresso inválido",
      ingresso: atual,
    };
  }

  await transacao(async (c) => {
    const pedido = await repo.buscarPedido(c, ingresso.pedidoId, true);
    if (pedido) {
      await repo.registrarHistorico(c, pedido.id, "VALIDAR_ENTRADA", autor.id,
        { ingressoId: ingresso.id, codigo: ingresso.codigo }, pedido.status);
    }
    return [];
  });

  return { aprovado: true, motivo: null, ingresso: await repo.buscarIngresso(pool, ingresso.id) };
}
