// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "eventos";
export const PORT = Number(process.env.PORT ?? 3001);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/**
 * Eventos que este serviço consome (routing keys).
 *
 * A reserva de lugares da Saga da compra (`compra.solicitada`) e a compensação
 * por conta removida (`usuario.removido`) entram nos lotes 3 e 5.
 */
export const SUBSCRIBES: string[] = [];

/**
 * Eventos que este serviço publica (routing keys).
 *
 * Ambos saem SEM destinatários: quem sabe quem comprou ingresso é o serviço de
 * Ingressos, e é ele que publica o aviso nominal. Consultar outro serviço por
 * HTTP para descobrir os compradores acoplaria os dois.
 */
export const PUBLISHES: string[] = ["evento.alterado.v1", "evento.cancelado.v1"];
