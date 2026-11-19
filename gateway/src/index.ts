import express from "express";
import { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { createProxyMiddleware } from "http-proxy-middleware";
import { CircuitBreaker } from "./breaker";
import {
  CB_LIMITE_FALHAS, CB_TEMPO_ABERTO_MS, JWT_SECRET, PORT,
  PROXY_TIMEOUT_MS, RABBITMQ_URL, SERVICOS, SERVICE_NAME, SUBSCRIBES,
} from "./config";
import { dbOk } from "./db";
import { brokerOk, connectBroker, subscribe } from "./messaging";
import { iniciarRelay, migrateOutbox, pendentes } from "./outbox";
import { migrate, semearAdmin } from "./auth/usuarios";
import { router as rotasAuth } from "./auth/rotas";

/**
 * API GATEWAY — entrada única do ArenaHub.
 *
 * Padrões GoF aplicados aqui:
 *  - FACADE: o cliente conhece um endereço só (8080) e ignora quantos serviços
 *    existem atrás dele e onde estão.
 *  - PROXY: cada requisição passa por um intermediário que autentica, injeta a
 *    identidade e protege o serviço de destino com um Circuit Breaker próprio.
 *
 * A AUTENTICAÇÃO mora aqui dentro (/api/auth/*), e não num quinto microsserviço,
 * porque o enunciado exige exatamente quatro serviços de domínio. Ver a
 * justificativa completa em auth/rotas.ts e no README.md.
 */
const app = express();

// Rotas que não exigem token.
const PUBLICAS = new Set(["POST /api/auth/register", "POST /api/auth/login"]);

// Um disjuntor por serviço: a queda de um não derruba os outros.
const breakers: Record<string, CircuitBreaker> = {};
for (const name of Object.keys(SERVICOS)) {
  breakers[name] = new CircuitBreaker({
    limiteFalhas: CB_LIMITE_FALHAS,
    tempoAbertoMs: CB_TEMPO_ABERTO_MS,
    aoMudar: (de, para) => console.log(`[gateway] circuito ${name}: ${de} -> ${para}`),
  });
}

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

/**
 * Estado de cada serviço e do seu disjuntor. É o que a interface usa para
 * explicar o que está indisponível durante a demonstração de tolerância a falhas.
 */
app.get("/status", async (_req, res) => {
  const entradas = await Promise.all(
    Object.entries(SERVICOS).map(async ([name, url]) => {
      let servico = "fora do ar";
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        servico = r.ok ? "no ar" : "degradado";
      } catch { /* fora do ar */ }
      return [name, { servico, circuito: breakers[name].nomeEstado }] as const;
    })
  );
  res.json(Object.fromEntries(entradas));
});

// 1) Nunca confiar em identidade vinda do cliente.
app.use((req, _res, next) => {
  delete req.headers["x-user-id"];
  delete req.headers["x-user-role"];
  next();
});

// 2) ID de correlação propagado para os serviços e para os eventos.
app.use((req, res, next) => {
  const id = (req.headers["x-correlation-id"] as string) ?? randomUUID();
  req.headers["x-correlation-id"] = id;
  res.locals.correlationId = id;
  res.setHeader("x-correlation-id", id);
  next();
});

// 3) Autenticação: valida o JWT e injeta a identidade para os serviços.
app.use("/api", (req, res, next) => {
  const rota = `${req.method} ${req.originalUrl.split("?")[0]}`;
  if (PUBLICAS.has(rota)) return next();

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return void res.status(401).json({ erro: "token ausente" });
  try {
    const dados = jwt.verify(auth.slice(7), JWT_SECRET) as jwt.JwtPayload;
    req.headers["x-user-id"] = String(dados.sub);
    req.headers["x-user-role"] = String(dados.papel);
    next();
  } catch {
    res.status(401).json({ erro: "token inválido ou expirado" });
  }
});

/**
 * 4) Autenticação servida pelo próprio Gateway.
 *
 * express.json() é aplicado SOMENTE aqui, de propósito: se o corpo fosse lido
 * antes do proxy, as requisições encaminhadas aos serviços chegariam sem corpo.
 */
app.use("/api/auth", express.json(), rotasAuth);

// 5) Circuit Breaker + roteamento para cada serviço de domínio.
const responder = (res: ServerResponse, status: number, corpo: object, extra: Record<string, string> = {}) => {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", ...extra });
  res.end(JSON.stringify(corpo));
};

for (const [name, target] of Object.entries(SERVICOS)) {
  const breaker = breakers[name];
  const prefixo = `/api/${name}`;

  // Porteiro: com o circuito aberto, recusa na hora sem tentar o serviço.
  app.use((req, res, next) => {
    const url = req.originalUrl;
    if (!(url === prefixo || url.startsWith(`${prefixo}/`) || url.startsWith(`${prefixo}?`))) return next();
    if (breaker.permitir()) return next();
    responder(res, 503, { erro: `serviço ${name} temporariamente indisponível`, circuito: breaker.nomeEstado },
      { "Retry-After": String(Math.ceil(CB_TEMPO_ABERTO_MS / 1000)) });
  });

  app.use(
    createProxyMiddleware({
      pathFilter: prefixo,
      target,
      changeOrigin: true,
      pathRewrite: { [`^${prefixo}`]: "" },
      proxyTimeout: PROXY_TIMEOUT_MS,
      timeout: PROXY_TIMEOUT_MS,
      on: {
        proxyRes: (proxyRes) => {
          if ((proxyRes.statusCode ?? 500) >= 500) breaker.registrarFalha();
          else breaker.registrarSucesso();
        },
        error: (_err, _req, res) => {
          breaker.registrarFalha();
          responder(res as ServerResponse, 502, { erro: `serviço ${name} não respondeu`, circuito: breaker.nomeEstado });
        },
      },
    })
  );
}

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
