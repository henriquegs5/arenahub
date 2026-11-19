// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "ingressos";
export const PORT = Number(process.env.PORT ?? 3002);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/** Eventos que este serviço consome (routing keys). */
export const SUBSCRIBES: string[] = [
  "lugares.reservados.v1",
  "reserva.recusada.v1",
  "pagamento.aprovado.v1",
  "pagamento.recusado.v1",
  "estorno.concluido.v1",
  "evento.cancelado.v1",
  "evento.alterado.v1",
  "usuario.removido.v1",
];

/** Eventos que este serviço publica (routing keys). */
export const PUBLISHES: string[] = [
  "compra.solicitada.v1",
  "pagamento.solicitado.v1",
  "pedido.cancelado.v1",
  "estorno.solicitado.v1",
  "ingresso.emitido.v1",
  "ingressos.afetados.v1",
];

/**
 * PRAZO DE EXPIRAÇÃO DO PEDIDO.
 *
 * Um pedido pode travar porque uma resposta da Saga se perdeu ou porque o
 * serviço de Pagamento está fora do ar. Sem prazo, os lugares ficariam
 * reservados para sempre e o evento esgotaria sem ter vendido.
 *
 * Passado o prazo, o varredor deste serviço expira o pedido e publica
 * `pedido.cancelado`; o serviço de Eventos devolve os lugares ao estoque. Isso
 * funciona mesmo com Pagamento parado, porque o varredor não depende dele.
 *
 * O padrão é curto (2 minutos) para caber na demonstração ao vivo.
 */
export const PEDIDO_EXPIRA_SEGUNDOS = Number(process.env.PEDIDO_EXPIRA_SEGUNDOS ?? 120);

/** Limite de ingressos por comprador, por evento (Chain of Responsibility). */
export const LIMITE_POR_COMPRADOR = Number(process.env.LIMITE_POR_COMPRADOR ?? 6);
