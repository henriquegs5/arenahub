# ArenaHub — Plataforma de eventos e venda de ingressos (Microsserviços)

Trabalho de Arquitetura de Software — CEFET/RJ 2026.1 — Grupo 5.

Plataforma de venda de ingressos para **eventos de e-sports e cultura gamer**:
campeonatos presenciais, convenções e encontros.

## Arquitetura

```
Frontend (React)
      │
      ▼
API Gateway (:8080) ── autenticação (JWT) ── gateway_db
      │
      ├─────────────┬─────────────┬────────────────┐
      ▼             ▼             ▼                ▼
   Eventos      Ingressos     Pagamento      Notificações     ← 4 microsserviços
  eventos_db   ingressos_db  pagamento_db  notificacoes_db       (1 container cada)
      └─────────────┴─────────────┴────────────────┘
                       RabbitMQ
              exchange arenahub.events (topic)
```

Os **quatro microsserviços** exigidos pelo enunciado, cada um em container Docker
independente, com banco e fila próprios:

| Serviço | Porta | Responsabilidade |
|---|---|---|
| `eventos` | 3001 | Cadastro, atualização e exclusão de eventos; data, local, capacidade; setores e lotes; reserva e liberação de lugares |
| `ingressos` | 3002 | Venda, emissão do ingresso digital, validação na entrada (check-in), cancelamento |
| `pagamento` | 3003 | Cobrança e estorno, com provedor externo simulado |
| `notificacoes` | 3004 | Avisos ao participante, incluindo atualizações de última hora |

`gateway` (8080) e `frontend` (3000) são **infraestrutura e apresentação**, não
serviços de domínio.

### Decisões de arquitetura

**A autenticação vive dentro do API Gateway, não num quinto serviço.**
O enunciado exige exatamente quatro microsserviços de domínio. O Gateway já é o
componente de infraestrutura que valida o JWT em toda requisição; emitir o token
é a outra metade da mesma responsabilidade. As contas ficam no banco próprio do
Gateway (`gateway_db`), ao qual nenhum serviço de domínio tem acesso. O Gateway
continua sem conhecer evento, ingresso ou pagamento: os serviços recebem apenas
`x-user-id` e `x-user-role`, mais as cópias de nome que chegam pelos eventos
`usuario.*`. Justificativa também registrada em `gateway/src/auth/rotas.ts`.

**Por que há mensageria se o enunciado fala em REST.**
O enunciado diz que a comunicação *pode* ser REST/JSON — é permissão, não
proibição de mensageria. O REST síncrono atende às consultas do frontend; as
mudanças de estado que atravessam serviços viajam por eventos assíncronos. São
os eventos que sustentam a Saga e a tolerância a falhas que o próprio enunciado
exige (um serviço fora do ar sem derrubar o resto).

### Regras que a arquitetura respeita

- **Database per Service**: um banco e um usuário por serviço; sem join e sem
  chave estrangeira entre serviços. Cada serviço guarda só o **ID** das entidades
  alheias, mais as cópias que chegaram por evento.
- **Sem biblioteca de domínio compartilhada**: `messaging.ts`, `auth.ts` e
  `outbox.ts` são duplicados de propósito em cada serviço. O contrato comum é o
  JSON Schema em `contracts/events/`, não código.
- **Transactional Outbox**: o evento é gravado na mesma transação do fato e só
  entregue ao broker depois do commit, com repetição até conseguir.
- **Consumidores idempotentes**: tabela `eventos_processados` em cada serviço.
- **Dead letter**: falha permanente vai para `<servico>.events.dlq` e pode ser
  inspecionada e reprocessada pelo administrador — nunca some em silêncio.
- **Permissões verificadas no backend**. Esconder botão não é controle de acesso.

## Perfis

| Perfil | Pode |
|---|---|
| `ADM` | Tudo: qualquer usuário, evento, pedido, ingresso e pagamento; vê todas as notificações |
| `ORGANIZADOR` | Cria e gerencia os próprios eventos, setores e lotes; vê as vendas; valida ingressos na entrada |
| `PARTICIPANTE` | Compra ingressos, vê e cancela os próprios pedidos e ingressos, recebe avisos |

O **cadastro público nunca cria um ADM**. O administrador inicial é criado na
subida do Gateway, de forma idempotente, a partir de `ADMIN_EMAIL` e
`ADMIN_SENHA` (padrões no `docker-compose.yml`):

```
admin@arenahub.local  /  arenahub123
```

## Executar

Requisito: Docker Desktop.

```
docker compose up --build
```

- Interface: http://localhost:3000
- Gateway: http://localhost:8080/health — estado dos serviços e disjuntores em `/status`
- RabbitMQ: http://localhost:15672 (guest / guest)

> **Trocou o conjunto de serviços?** O `infra/postgres/init.sql` só roda com o
> volume do Postgres vazio. Rode `docker compose down -v` antes de subir de novo.

## Tolerância a falhas (cenários do enunciado)

```
docker compose stop pagamento      # catálogo, ingressos emitidos e check-in seguem funcionando
docker compose stop notificacoes   # a compra funciona do início ao fim; os avisos chegam depois
```

A fila é durável: com Notificações fora do ar, os eventos ficam retidos e são
entregues quando o serviço volta. O Circuit Breaker do Gateway
(`gateway/src/breaker.ts`) isola o serviço doente para que a interface explique o
que está indisponível em vez de travar.

## Conferir se compila (sem Docker)

```
./scripts/check-all.sh      # todos os serviços e o gateway
cd frontend && npm run build
```

## Estrutura

```
services/<nome>/src      código de cada microsserviço (config, db, messaging, outbox, auth, routes)
gateway/src              API Gateway; auth/ guarda a autenticação absorvida
frontend/src             interface React (Vite + nginx)
contracts/events/        JSON Schema de cada evento
infra/postgres/init.sql  cria um banco e um usuário por serviço
docs/                    planejamento, contratos e artefatos de entrega
```

## Limitações conhecidas

- O JWT dura 8 horas e **não é renovado**: numa sessão muito longa, é preciso
  entrar de novo. Aceitável para a demonstração.
- A marcação de leitura das notificações ainda é guardada no navegador; passa
  para o backend junto com o CRUD completo de notificações.
