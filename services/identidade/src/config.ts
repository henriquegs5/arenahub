// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "identidade";
export const PORT = Number(process.env.PORT ?? 3001);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/** Eventos que este serviço consome (routing keys). */
export const SUBSCRIBES: string[] = [];

/** Eventos que este serviço publica (documentação; implementados na Etapa 3). */
export const PUBLISHES: string[] = ["usuario.registrado.v1"];

export const JWT_SECRET = process.env.JWT_SECRET ?? "arenahub-dev-secret-change-me";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "8h";
