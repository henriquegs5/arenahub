# ArenaHub — Plataforma de campeonatos de e-sports (Microsserviços)

Trabalho de Arquitetura de Software — CEFET/RJ 2026.1 — Grupo 5.

## Arquitetura
```
Frontend (React) → API Gateway (:8080) → Identidade | Equipes | Torneios | Partidas | Ranking | Notificações
                                              └──── RabbitMQ (eventos) ────┘      └── Postgres (1 banco por serviço)
```
- Banco por serviço (sem joins/FKs entre serviços) · REST síncrono só para consultas · eventos assíncronos para propagar mudanças.
- Contratos de eventos: `docs/02-contratos-eventos.md` e `contracts/events/`.
- Planejamento: `docs/01-planejamento.md`.

## Executar
Requisito: Docker Desktop.
```
docker compose up --build
```
- Interface: http://localhost:3000
- Gateway: http://localhost:8080/health (estado dos serviços: /status)
- RabbitMQ: http://localhost:15672 (guest / guest)

## Conferir se compila (sem Docker)
```
./scripts/check-all.sh
```

## Estrutura
```
services/<nome>/src      código de cada serviço (config, db, messaging, index)
gateway/                 API Gateway
frontend/                interface da demo
contracts/events/        JSON Schema dos eventos
infra/postgres/init.sql  cria um banco e um usuário por serviço
docs/                    planejamento, contratos e artefatos de entrega
```
