import os

SERVICE_NAME = "gateway"
PORT = int(os.getenv("PORT", "8080"))

DATABASE_URL = os.getenv("DATABASE_URL", "postgres://arenahub:arenahub@postgres:5432/arenahub_gateway")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")

PUBLISHES = ["usuario.registrado.v1", "usuario.atualizado.v1", "usuario.removido.v1"]
SUBSCRIBES = []

JWT_SECRET = os.getenv("JWT_SECRET", "arenahub-dev-secret-change-me")
JWT_EXPIRES_IN_HOURS = int(os.getenv("JWT_EXPIRES_IN_HOURS", "8"))

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@arenahub.local").strip().lower()
ADMIN_SENHA = os.getenv("ADMIN_SENHA", "arenahub123")
ADMIN_NOME = os.getenv("ADMIN_NOME", "Administrador")

CB_LIMITE_FALHAS = int(os.getenv("CB_LIMITE_FALHAS", "3"))
CB_TEMPO_ABERTO_MS = int(os.getenv("CB_TEMPO_ABERTO_MS", "10000"))
PROXY_TIMEOUT_MS = int(os.getenv("PROXY_TIMEOUT_MS", "5000"))

SERVICOS = {
    "eventos": os.getenv("EVENTOS_URL", "http://eventos:3001"),
    "ingressos": os.getenv("INGRESSOS_URL", "http://ingressos:3002"),
    "pagamento": os.getenv("PAGAMENTO_URL", "http://pagamento:3003"),
    "notificacoes": os.getenv("NOTIFICACOES_URL", "http://notificacoes:3004"),
}

EVENTO_TENTATIVAS = int(os.getenv("EVENTO_TENTATIVAS", "3"))
EVENTO_ESPERA_S = float(os.getenv("EVENTO_ESPERA_S", "1.0"))
OUTBOX_INTERVALO_MS = int(os.getenv("OUTBOX_INTERVALO_MS", "1000"))
