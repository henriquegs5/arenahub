// Configuração própria deste serviço (nada compartilhado entre serviços).
export const SERVICE_NAME = "notificacoes";
export const PORT = Number(process.env.PORT ?? 3004);
export const DATABASE_URL = process.env.DATABASE_URL ?? "";
export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost";

/**
 * Eventos que este serviço consome (routing keys).
 *
 * Quem publica informa os DESTINATÁRIOS (lista de IDs de usuário) e os NOMES
 * LEGÍVEIS no payload. Este serviço nunca consulta outro para descobrir a quem
 * avisar: isso acoplaria os dois e quebraria a independência dos microsserviços.
 */
export const SUBSCRIBES: string[] = [
  // conta
  "usuario.registrado.v1",
  "usuario.atualizado.v1",
  "usuario.removido.v1",
  // Saga da compra
  "ingresso.emitido.v1",
  "pagamento.recusado.v1",
  "pedido.cancelado.v1",
  "estorno.concluido.v1",
  // atualizacao de ultima hora: destinatarios resolvidos por Ingressos
  "ingressos.afetados.v1",
];

/** Eventos que este serviço publica (routing keys). */
export const PUBLISHES: string[] = [];
