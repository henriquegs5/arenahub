// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "ingressos";
export const PORT = Number(process.env.PORT ?? 3002);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/** Eventos que este serviço consome (routing keys). */
export const SUBSCRIBES: string[] = [];

/** Eventos que este serviço publica (routing keys). */
export const PUBLISHES: string[] = [];
