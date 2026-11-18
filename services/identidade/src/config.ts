// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "identidade";
export const PORT = Number(process.env.PORT ?? 3001);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/** Eventos que este serviço consome (routing keys). */
export const SUBSCRIBES: string[] = [];

/** Eventos que este serviço publica (routing keys). */
export const PUBLISHES: string[] = ["usuario.registrado.v1", "usuario.atualizado.v1", "usuario.removido.v1"];

export const JWT_SECRET = process.env.JWT_SECRET ?? "arenahub-dev-secret-change-me";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "8h";

/** Administrador criado na subida do serviço, de forma idempotente. */
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
export const ADMIN_SENHA = process.env.ADMIN_SENHA ?? "";
export const ADMIN_NOME = process.env.ADMIN_NOME ?? "Administrador";
