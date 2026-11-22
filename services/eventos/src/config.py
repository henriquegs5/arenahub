import os

SERVICE_NAME = "eventos"
PORT = int(os.getenv("PORT", "3001"))
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://arenahub:arenahub@postgres:5432/arenahub_eventos")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")

EVENTO_TENTATIVAS = int(os.getenv("EVENTO_TENTATIVAS", "3"))
EVENTO_ESPERA_S = float(os.getenv("EVENTO_ESPERA_S", "1.0"))
OUTBOX_INTERVALO_MS = int(os.getenv("OUTBOX_INTERVALO_MS", "1000"))

SUBSCRIBES = [
    "compra.solicitada.v1",
    "pedido.cancelado.v1",
    "evento.cancelado.v1",
    "usuario.removido.v1",
]

PUBLISHES = [
    "evento.alterado.v1",
    "evento.cancelado.v1",
    "lugares.reservados.v1",
    "reserva.recusada.v1",
    "lugares.liberados.v1",
]
