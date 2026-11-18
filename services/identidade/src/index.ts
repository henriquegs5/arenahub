import express from "express";
import { randomUUID } from "node:crypto";
import { PORT, RABBITMQ_URL, SERVICE_NAME, SUBSCRIBES } from "./config";
import { dbOk } from "./db";
import { brokerOk, connectBroker, subscribe } from "./messaging";
import { iniciarRelay, migrateOutbox, pendentes } from "./outbox";
import { router } from "./routes";
import { migrate, semearAdmin } from "./usuarios";

const app = express();
app.use(express.json());

// ID de correlação propagado entre serviços (log e eventos).
app.use((req, res, next) => {
  const id = (req.headers["x-correlation-id"] as string) ?? randomUUID();
  res.locals.correlationId = id;
  res.setHeader("x-correlation-id", id);
  next();
});

app.get("/health", async (_req, res) => {
  const db = await dbOk();
  const outbox = db ? await pendentes().catch(() => -1) : -1;
  res.status(db ? 200 : 503).json({
    service: SERVICE_NAME,
    status: db ? "ok" : "degraded",
    db,
    broker: brokerOk(),
    eventosPendentes: outbox,
  });
});

app.use("/", router);

async function main() {
  await migrate();
  await migrateOutbox();
  await semearAdmin();
  await connectBroker(RABBITMQ_URL);
  await subscribe(SUBSCRIBES, async (event) => {
    console.log(`[${SERVICE_NAME}] evento ${event.type}.v${event.version} corr=${event.correlationId}`);
  });
  iniciarRelay();
  app.listen(PORT, () => console.log(`[${SERVICE_NAME}] porta ${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
