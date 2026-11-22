import os

SERVICE_NAME = "ingressos"
PORT = int(os.getenv("PORT", "3002"))
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://arenahub:arenahub@postgres:5432/arenahub_ingressos")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")

EVENTO_TENTATIVAS = int(os.getenv("EVENTO_TENTATIVAS", "3"))
EVENTO_ESPERA_S = float(os.getenv("EVENTO_ESPERA_S", "1.0"))
OUTBOX_INTERVALO_MS = int(os.getenv("OUTBOX_INTERVALO_MS", "1000"))

PEDIDO_EXPIRA_SEGUNDOS = int(os.getenv("PEDIDO_EXPIRA_SEGUNDOS", "120"))
LIMITE_POR_COMPRADOR = int(os.getenv("LIMITE_POR_COMPRADOR", "6"))
EXPIRACAO_INTERVALO_MS = int(os.getenv("EXPIRACAO_INTERVALO_MS", "15000"))

SUBSCRIBES = [
    "lugares.reservados.v1",
    "reserva.recusada.v1",
    "pagamento.aprovado.v1",
    "pagamento.recusado.v1",
    "estorno.concluido.v1",
    "evento.cancelado.v1",
    "evento.alterado.v1",
    "usuario.removido.v1",
]

PUBLISHES = [
    "compra.solicitada.v1",
    "pagamento.solicitado.v1",
    "pedido.cancelado.v1",
    "estorno.solicitado.v1",
    "ingresso.emitido.v1",
    "ingressos.afetados.v1",
]
