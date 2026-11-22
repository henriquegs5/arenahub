import os

SERVICE_NAME = "pagamento"
PORT = int(os.getenv("PORT", 3003))
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://pagamento_user:pagamento_pw@postgres:5432/pagamento_db")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672")

SUBSCRIBES = [
    "pagamento.solicitado.v1",
    "estorno.solicitado.v1",
]

PUBLISHES = [
    "pagamento.aprovado.v1",
    "pagamento.recusado.v1",
    "estorno.concluido.v1",
]

EVENTO_TENTATIVAS = int(os.getenv("EVENTO_TENTATIVAS", 3))
EVENTO_ESPERA_S = float(os.getenv("EVENTO_ESPERA_MS", 500)) / 1000.0
OUTBOX_POLL_INTERVAL_S = 1.0
