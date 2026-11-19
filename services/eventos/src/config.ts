// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "eventos";
export const PORT = Number(process.env.PORT ?? 3001);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/**
 * Eventos que este serviço consome (routing keys).
 *
 * `evento.cancelado` é publicado por ESTE serviço e consumido por ele mesmo, de
 * propósito: assim o estoque volta a bater mesmo que a cadeia de cancelamento
 * dos ingressos demore ou falhe.
 */
export const SUBSCRIBES: string[] = [
  "compra.solicitada.v1",
  "pedido.cancelado.v1",
  "evento.cancelado.v1",
  "usuario.removido.v1",
];

/**
 * Eventos que este serviço publica (routing keys).
 *
 * Ambos saem SEM destinatários: quem sabe quem comprou ingresso é o serviço de
 * Ingressos, e é ele que publica o aviso nominal. Consultar outro serviço por
 * HTTP para descobrir os compradores acoplaria os dois.
 */
export const PUBLISHES: string[] = [
  "evento.alterado.v1",
  "evento.cancelado.v1",
  "lugares.reservados.v1",
  "reserva.recusada.v1",
  "lugares.liberados.v1",
];
