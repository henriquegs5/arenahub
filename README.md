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

## A Saga da compra

A compra responde **HTTP 202**, não 201: o pedido nasce `PENDENTE` e a Saga
coreografada resolve o resto por eventos.

```
Ingressos  cria o pedido PENDENTE        → compra.solicitada
Eventos    valida e RESERVA os lugares   → lugares.reservados | reserva.recusada
Ingressos  pede a cobrança               → pagamento.solicitado
Pagamento  processa                      → pagamento.aprovado | pagamento.recusado
  aprovado → Ingressos emite os ingressos → ingresso.emitido → Notificações avisa
  recusado → COMPENSAÇÃO: pedido.cancelado → Eventos devolve os lugares
```

O desenho completo, com os contratos de cada evento, está em
`docs/02-contratos-eventos.md`.

### Provocar uma recusa de pagamento (na demonstração)

O provedor de pagamento é **simulado** e **determinístico** — não há sorteio.
Há dois gatilhos, e qualquer um serve para mostrar a compensação ao vivo:

| Gatilho | Como provocar | Efeito |
|---|---|---|
| **Meio de pagamento** | escolher **"Cartão de teste (recusa sempre)"** (`CARTAO_RECUSADO`) | recusa **qualquer** valor, sempre |
| **Valor** | fazer o total terminar em **66 centavos** (R$ 6,66, R$ 80,66, R$ 120,66…) | recusa em **qualquer** meio de pagamento |

O caminho mais direto é o primeiro: basta trocar o meio de pagamento na tela de
compra. O segundo existe para mostrar que a regra vale para qualquer meio.

A API declara os dois gatilhos em `GET /api/pagamento/meta/meios`, e a regra
está em `services/pagamento/src/meios.ts` (`CENTAVOS_RECUSA`).

Também dá para provocar uma **reserva recusada** (antes do pagamento): basta
pedir mais lugares do que o lote tem, ou comprar de um evento cujas vendas não
estejam abertas.

### Pedido que trava: expiração

Um pedido pode ficar preso porque uma resposta da Saga se perdeu ou porque o
serviço de Pagamento está fora do ar. Sem saída, os lugares ficariam reservados
para sempre e o evento esgotaria sem ter vendido.

O serviço de Ingressos roda um **varredor** que encerra os pedidos vencidos e
publica `pedido.cancelado`; o serviço de Eventos devolve os lugares ao estoque.
O varredor vive dentro do próprio serviço de Ingressos e **não depende de
Pagamento** — é por isso que funciona justamente no cenário em que Pagamento
está parado.

```
PEDIDO_EXPIRA_SEGUNDOS   padrão 120s (curto, para caber na demonstração)
EXPIRACAO_INTERVALO_MS   padrão 15000ms (de quanto em quanto o varredor roda)
```

Pedidos já `PAGO` nunca expiram: dinheiro que entrou se resolve concluindo a
emissão.

### Pagamento seguro

O enunciado pede que as transações sejam processadas "de forma segura". Neste
sistema isso significa, concretamente:

- **Nenhum dado sensível de cartão entra no sistema.** Não existe coluna para
  número, CVV ou validade em lugar nenhum — veja `services/pagamento/src/repositorio.ts`.
- O que trafega e é gravado é apenas uma **referência opaca** (token) ao meio de
  pagamento, como a que um provedor real devolve depois de tokenizar o cartão no
  navegador do comprador.
- A referência é **mascarada** em log e na API (`****1234`).
- Uma validação da compra **recusa explicitamente** qualquer coisa que pareça um
  número de cartão, para que um cliente mal escrito não vaze dado sensível para
  dentro do sistema.

### Idempotência das compensações

Toda compensação pode chegar duas vezes — o broker entrega ao menos uma vez.
Além da tabela `eventos_processados` de cada serviço, cada compensação tem uma
defesa no próprio dado:

- **Liberar lugares:** a tabela `reservas` do serviço de Eventos guarda o estado
  por pedido. Só libera uma reserva `ATIVA`, e a marca `LIBERADA`. Repetir não
  devolve lugares duas vezes, e um pedido que expirou **antes** de reservar não
  devolve nada — um decremento cego corromperia o estoque.
- **Cobrar:** `transacoes.pedido_id` é `UNIQUE`. Reentrega não cobra de novo.
- **Estornar:** transação já `ESTORNADO` não é estornada outra vez.
- **Validar entrada:** `UPDATE ... WHERE status = 'EMITIDO'` — a segunda leitura
  do mesmo QR não passa.

## Integridade e casos de borda

Cada caso abaixo tem uma checagem automatizada que o reproduz de verdade
(derrubando serviços, publicando mensagens no broker), não só no papel.

| Situação | O que acontece |
|---|---|
| **Usuário excluído com ingressos** | `usuario.removido` → Ingressos cancela os pedidos e os ingressos → Pagamento estorna → Eventos devolve os lugares. Os avisos da cadeia que ainda chegarem não ficam órfãos: Notificações guarda um registro de contas removidas, vindo do próprio evento. |
| **Organizador excluído com evento ativo** | Eventos cancela os eventos dele (`evento.cancelado`) e a cadeia normal de cancelamento corre: ingressos invalidados, estorno, todos os compradores avisados. |
| **Evento cancelado com ingressos vendidos** | Ingressos `INVALIDADO`, lugares devolvidos, PIX/cartão estornados automaticamente. **Boleto não estorna sozinho**: a transação fica `APROVADA` e o comprador recebe o aviso de que o reembolso é manual. |
| **Evento excluído** | Só enquanto ninguém comprou. Com vendas (ou já cancelado), a exclusão é recusada: o caminho é cancelar. |
| **Pedido que trava** | Expira sozinho (ver "Pedido que trava: expiração"), com ou sem o Pagamento no ar. O ADM também pode descartá-lo na hora, cancelando o pedido. |
| **Pagamento aprovado depois de o pedido acabar** | O cliente não fica cobrado sem ingresso: Ingressos pede o estorno. |
| **Reserva que chega depois de o pedido acabar** | Ingressos manda devolver os lugares; a reserva não fica `ATIVA` para sempre. |
| **Ingresso validado duas vezes** | A segunda leitura é recusada com o motivo ("já utilizado"). Vale mesmo com duas leituras simultâneas. |
| **Ingresso de evento cancelado ou de pedido cancelado** | Recusado na entrada, com o motivo. |
| **Validação por outro organizador** | Recusada: só o organizador **do evento** (ou o ADM) valida, e a recusa não vaza dados do ingresso. |

### Dead letter

Mensagem que falha de forma permanente no consumidor **não é descartada**: depois
das tentativas, vai para `<servico>.events.dlq`. O ADM administra pela API, em
cada serviço (`eventos`, `ingressos`, `pagamento`, `notificacoes`) e no Gateway
(`/api/auth/dlq`):

```
GET    /api/<servico>/dlq              lista o que ficou parado (total + mensagens)
POST   /api/<servico>/dlq/reprocessar  devolve as mensagens à fila do serviço
DELETE /api/<servico>/dlq              descarta de vez
```

O reprocessamento devolve a mensagem **à fila do próprio serviço**, e não ao
exchange: uma mensagem morta perde a routing key original, e o exchange a
espalharia para serviços que nem falharam.

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
./scripts/check-all.sh              # compila todos os serviços e o gateway
python scripts/check-contratos.py   # código x JSON Schemas x catálogo de eventos
cd services/eventos && npm test     # testes do domínio (Composite, State, Strategy)
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
- A interface foi validada com os endpoints que ela usa e com o fluxo de compra
  no navegador; as telas de administração (Usuários e Sistema), o check-in na
  interface e o layout em celular não foram inspecionados visualmente.
