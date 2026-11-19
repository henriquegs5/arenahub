import express from "express";
import { randomUUID } from "node:crypto";
import { PORT, RABBITMQ_URL, SERVICE_NAME, SUBSCRIBES } from "./config";
import { dbOk } from "./db";
import { brokerOk, connectBroker, subscribe } from "./messaging";
import { CanalEmailAdapter, CanalTela, Notificador } from "./canais";
import { ObservadorAvisos, ObservadorUsuarioRemovido } from "./observadores";
import { DespachanteEventos } from "./observer";
import { marcarProcessado, desmarcarProcessado, migrate } from "./repositorio";
import { router } from "./routes";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const id = (req.headers["x-correlation-id"] as string) ?? randomUUID();
  res.locals.correlationId = id;
  res.setHeader("x-correlation-id", id);
  next();
});

app.get("/health", async (_req, res) => {
  const db = await dbOk();
  res.status(db ? 200 : 503).json({
    service: SERVICE_NAME,
    status: db ? "ok" : "degraded",
    db,
    broker: brokerOk(),
  });
});

app.use("/", router);

/**
 * Padrão GoF OBSERVER: o despachante recebe cada evento do broker e avisa apenas
 * os observadores interessados. Comportamentos novos entram como observadores
 * novos, sem mexer no consumidor de mensagens.
 */
const despachante = new DespachanteEventos()
  .assinar(new ObservadorAvisos(new Notificador([new CanalTela(), new CanalEmailAdapter()])))
  .assinar(new ObservadorUsuarioRemovido());

async function main() {
  await migrate();
  await connectBroker(RABBITMQ_URL);
  await subscribe(SUBSCRIBES, async (event) => {
    console.log(`[${SERVICE_NAME}] evento ${event.type}.v${event.version} corr=${event.correlationId}`);
    if (!(await marcarProcessado(event.eventId))) return; // idempotência
    try {
      await despachante.notificar(event);
    } catch (e) {
      await desmarcarProcessado(event.eventId);
      throw e;
    }
  });
  app.listen(PORT, () => console.log(`[${SERVICE_NAME}] porta ${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
