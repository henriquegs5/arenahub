import express, { NextFunction, Request, Response } from "express";
import { ServerResponse } from "node:http";
import jwt from "jsonwebtoken";
import { createProxyMiddleware } from "http-proxy-middleware";
import { CircuitBreaker } from "./breaker";

// API Gateway: Facade (entrada única) + Proxy (valida JWT e protege cada serviço com Circuit Breaker).
const app = express();
const PORT = Number(process.env.PORT ?? 8080);
const JWT_SECRET = process.env.JWT_SECRET ?? "arenahub-dev-secret-change-me";
const LIMITE_FALHAS = Number(process.env.CB_LIMITE_FALHAS ?? 3);
const TEMPO_ABERTO_MS = Number(process.env.CB_TEMPO_ABERTO_MS ?? 10000);
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS ?? 5000);

const routes: Record<string, string> = {
  identidade: process.env.IDENTIDADE_URL ?? "http://localhost:3001",
  equipes: process.env.EQUIPES_URL ?? "http://localhost:3002",
  torneios: process.env.TORNEIOS_URL ?? "http://localhost:3003",
  partidas: process.env.PARTIDAS_URL ?? "http://localhost:3004",
  ranking: process.env.RANKING_URL ?? "http://localhost:3005",
  notificacoes: process.env.NOTIFICACOES_URL ?? "http://localhost:3006",
};

// Um disjuntor por serviço: a queda de um não derruba os outros.
const breakers: Record<string, CircuitBreaker> = {};
for (const name of Object.keys(routes)) {
  breakers[name] = new CircuitBreaker({
    limiteFalhas: LIMITE_FALHAS,
    tempoAbertoMs: TEMPO_ABERTO_MS,
    aoMudar: (de, para) => console.log(`[gateway] circuito ${name}: ${de} -> ${para}`),
  });
}

// Rotas que não exigem token.
const PUBLICAS = new Set(["POST /api/identidade/register", "POST /api/identidade/login"]);

app.get("/health", (_req, res) => res.json({ service: "gateway", status: "ok" }));

// Estado de cada serviço e do seu circuito (útil na demo).
app.get("/status", async (_req, res) => {
  const entradas = await Promise.all(
    Object.entries(routes).map(async ([name, url]) => {
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

// 2) Autenticação: valida o JWT e injeta a identidade para os serviços.
app.use("/api", (req: Request, res: Response, next: NextFunction) => {
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

// 3) Circuit Breaker + roteamento para cada serviço.
const responder = (res: ServerResponse, status: number, corpo: object, extra: Record<string, string> = {}) => {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", ...extra });
  res.end(JSON.stringify(corpo));
};

for (const [name, target] of Object.entries(routes)) {
  const breaker = breakers[name];
  const prefixo = `/api/${name}`;

  // Porteiro: com o circuito aberto, recusa na hora sem tentar o serviço.
  app.use((req, res, next) => {
    const url = req.originalUrl;
    if (!(url === prefixo || url.startsWith(`${prefixo}/`) || url.startsWith(`${prefixo}?`))) return next();
    if (breaker.permitir()) return next();
    responder(res, 503, { erro: `serviço ${name} temporariamente indisponível`, circuito: breaker.nomeEstado },
      { "Retry-After": String(Math.ceil(TEMPO_ABERTO_MS / 1000)) });
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

app.listen(PORT, () => console.log(`[gateway] porta ${PORT}`));
