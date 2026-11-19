// Configuracao propria deste servico (nada compartilhado entre servicos).
export const SERVICE_NAME = "pagamento";
export const PORT = Number(process.env.PORT ?? 3003);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/** Eventos que este servico consome (routing keys). */
export const SUBSCRIBES: string[] = [
  "pagamento.solicitado.v1",
  "estorno.solicitado.v1",
];

/** Eventos que este servico publica (routing keys). */
export const PUBLISHES: string[] = [
  "pagamento.aprovado.v1",
  "pagamento.recusado.v1",
  "estorno.concluido.v1",
];
