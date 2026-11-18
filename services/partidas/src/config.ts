// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "partidas";
export const PORT = Number(process.env.PORT ?? 3004);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/** Eventos que este serviço consome (routing keys). */
export const SUBSCRIBES: string[] = ["confrontos.gerados.v1"];

/** Eventos que este serviço publica (documentação; implementados na Etapa 3). */
export const PUBLISHES: string[] = ["resultado.informado.v1", "resultado.confirmado.v1", "resultado.contestado.v1"];
