// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "equipes";
export const PORT = Number(process.env.PORT ?? 3002);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/** Eventos que este serviço consome (routing keys). */
export const SUBSCRIBES: string[] = ["inscricao.solicitada.v1"];

/** Eventos que este serviço publica (documentação; implementados na Etapa 3). */
export const PUBLISHES: string[] = ["equipe.criada.v1", "equipe.atualizada.v1", "equipe.validada.v1", "equipe.rejeitada.v1"];

// Regra de negócio: tamanho da equipe.
export const TAMANHO_MIN = Number(process.env.TAMANHO_MIN ?? 2);
export const TAMANHO_MAX = Number(process.env.TAMANHO_MAX ?? 5);
