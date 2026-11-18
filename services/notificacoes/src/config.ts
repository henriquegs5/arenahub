// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "notificacoes";
export const PORT = Number(process.env.PORT ?? 3006);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/** Eventos que este serviço consome (routing keys). */
export const SUBSCRIBES: string[] = ["usuario.registrado.v1", "resultado.informado.v1", "resultado.confirmado.v1", "resultado.contestado.v1", "torneio.finalizado.v1"];

/** Eventos que este serviço publica (documentação; implementados na Etapa 3). */
export const PUBLISHES: string[] = [];
