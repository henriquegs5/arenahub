import express from "express";
import { randomUUID } from "node:crypto";
import { PORT, RABBITMQ_URL, SERVICE_NAME, SUBSCRIBES } from "./config";
import { dbOk } from "./db";
import { connectBroker, subscribe } from "./messaging";
import { router } from "./routes";
import { migrate } from "./usuarios";

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
  res.status(db ? 200 : 503).json({ service: SERVICE_NAME, status: db ? "ok" : "degraded", db });
});

app.use("/", router);

async function main() {
  await migrate();
  await connectBroker(RABBITMQ_URL);
  await subscribe(SUBSCRIBES, async (event) => {
    // TODO (Etapa 3): tratar o evento de forma idempotente.
    console.log(`[${SERVICE_NAME}] evento ${event.type}.v${event.version} corr=${event.correlationId}`);
  });
  app.listen(PORT, () => console.log(`[${SERVICE_NAME}] porta ${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
