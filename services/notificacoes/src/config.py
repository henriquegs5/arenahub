import os

SERVICE_NAME = "notificacoes"
PORT = int(os.getenv("PORT", 3004))
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://notificacoes_user:notificacoes_pw@postgres:5432/notificacoes_db")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672")

SUBSCRIBES = [
    # conta
    "usuario.registrado.v1",
    "usuario.atualizado.v1",
    "usuario.removido.v1",
    # Saga da compra
    "ingresso.emitido.v1",
    "pagamento.recusado.v1",
    "pedido.cancelado.v1",
    "estorno.concluido.v1",
    # atualização de última hora
    "ingressos.afetados.v1",
]

PUBLISHES = []

EVENTO_TENTATIVAS = int(os.getenv("EVENTO_TENTATIVAS", 3))
EVENTO_ESPERA_S = float(os.getenv("EVENTO_ESPERA_MS", 500)) / 1000.0
