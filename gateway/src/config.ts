// Configuração do Gateway. Nada é compartilhado com os serviços de domínio.
export const SERVICE_NAME = "gateway";
export const PORT = Number(process.env.PORT ?? 8080);

/**
 * O Gateway tem banco próprio, usado SOMENTE para autenticação (contas e papéis).
 * Nenhum serviço de domínio acessa este banco, e o Gateway não acessa o deles.
 */
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/** Eventos que o Gateway publica (routing keys). */
export const PUBLISHES: string[] = ["usuario.registrado.v1", "usuario.atualizado.v1", "usuario.removido.v1"];

/** O Gateway não consome eventos: ele apenas anuncia mudanças nas contas. */
export const SUBSCRIBES: string[] = [];

export const JWT_SECRET = process.env.JWT_SECRET ?? "arenahub-dev-secret-change-me";
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "8h";

/** Administrador criado na subida, de forma idempotente. */
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
export const ADMIN_SENHA = process.env.ADMIN_SENHA ?? "";
export const ADMIN_NOME = process.env.ADMIN_NOME ?? "Administrador";

/** Circuit Breaker e proxy. */
export const CB_LIMITE_FALHAS = Number(process.env.CB_LIMITE_FALHAS ?? 3);
export const CB_TEMPO_ABERTO_MS = Number(process.env.CB_TEMPO_ABERTO_MS ?? 10000);
export const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS ?? 5000);

/**
 * Os QUATRO microsserviços de domínio exigidos pelo enunciado.
 * A autenticação NÃO é um deles: vive aqui dentro (ver auth/rotas.ts).
 */
export const SERVICOS: Record<string, string> = {
  eventos: process.env.EVENTOS_URL ?? "http://localhost:3001",
  ingressos: process.env.INGRESSOS_URL ?? "http://localhost:3002",
  pagamento: process.env.PAGAMENTO_URL ?? "http://localhost:3003",
  notificacoes: process.env.NOTIFICACOES_URL ?? "http://localhost:3004",
};
