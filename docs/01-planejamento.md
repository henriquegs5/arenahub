# ArenaHub — Planejamento

Plataforma de gestão de eventos e venda de ingressos para e-sports e cultura gamer.

## Serviços e dono dos dados

O enunciado exige **quatro microsserviços**, cada um em container Docker independente.

| Serviço | Responsabilidade | Dados exclusivos |
|---|---|---|
| Eventos | Cadastro, atualização e exclusão de eventos; data, local, capacidade; setores e lotes; reserva e liberação de lugares | eventos, setores, lotes |
| Ingressos | Venda, emissão do ingresso digital, validação na entrada, cancelamento | pedidos, ingressos, histórico |
| Pagamento | Cobrança e estorno, com provedor externo simulado | transações |
| Notificações | Avisos ao participante, inclusive atualizações de última hora | notificações |
| *Gateway* | *Infraestrutura*: entrada única, autenticação (JWT), Circuit Breaker | contas de usuário |
| *Frontend* | *Apresentação*: interface React | — |

Gateway e Frontend **não** são serviços de domínio. A autenticação foi absorvida pelo
Gateway justamente para manter o número de microsserviços em quatro — justificativa em
`README.md` e em `gateway/src/auth/rotas.ts`.

## Saga da compra (coreografada, com compensação)

```
Comprador → Ingressos: cria pedido PENDENTE          → compra.solicitada
Eventos:   verifica disponibilidade e reserva        → lugares.reservados | reserva.recusada
Ingressos: solicita a cobrança                       → pagamento.solicitado
Pagamento: processa                                  → pagamento.aprovado | pagamento.recusado
  aprovado  → Ingressos emite o ingresso             → ingresso.emitido → Notificações avisa
  recusado  → COMPENSAÇÃO: Eventos libera os lugares, o pedido vai a CANCELADO, o comprador é avisado
```

A resposta HTTP da compra é **202**: o processamento é assíncrono e o pedido nasce pendente.

Cancelamento de evento dispara outra cadeia:
`evento.cancelado` → Ingressos invalida os ingressos → Pagamento estorna → Notificações avisa todos os compradores.

## Máquinas de estado

- **Evento**: `RASCUNHO → PUBLICADO → VENDAS_ABERTAS → VENDAS_ENCERRADAS → REALIZADO`
  (`CANCELADO` a partir dos anteriores)
- **Pedido**: `PENDENTE → RESERVADO → AGUARDANDO_PAGAMENTO → PAGO → CONCLUIDO`
  (`CANCELADO` por recusa, cancelamento ou expiração)
- **Ingresso**: `EMITIDO → UTILIZADO` (`CANCELADO` / `INVALIDADO`)
- **Circuito do Gateway**: `FECHADO → ABERTO → MEIO_ABERTO → FECHADO`

## Padrões GoF

| Padrão | Onde | Uso no domínio de ingressos |
|---|---|---|
| Strategy | Ingressos, Pagamento | Política de preço (inteira, meia, lote, cortesia) e meio de pagamento |
| Factory Method | Ingressos, Pagamento | Cria a estratégia de preço ou de meio de pagamento |
| Composite | Eventos | Evento → setores → lotes, agregando capacidade e disponibilidade |
| State | Eventos, Ingressos, Gateway | Ciclo do evento, do pedido, do ingresso e do disjuntor |
| Chain of Responsibility | Ingressos | Validações da compra: evento publicado, vendas abertas, lote vigente, capacidade, limite por comprador |
| Command | Ingressos | Ações sobre o pedido (pagar, cancelar, estornar, validar entrada) com histórico |
| Observer | Notificações, Ingressos, Pagamento | Despacho dos eventos nos consumidores |
| Adapter | Pagamento, Notificações | Provedor de pagamento simulado e canais de aviso |
| Facade + Proxy | Gateway | Entrada única, JWT, Circuit Breaker |

Arquiteturais: API Gateway, Database per Service, Saga coreografada, Publish/Subscribe,
Circuit Breaker, Transactional Outbox, Dead Letter Queue.

## Perfis

| Perfil | Pode |
|---|---|
| `ADM` | Tudo; vê todas as notificações; não sujeito às limitações dos demais |
| `ORGANIZADOR` | Cria e gerencia os próprios eventos, setores e lotes; vê as vendas; valida ingressos na entrada |
| `PARTICIPANTE` | Compra ingressos, vê e cancela os próprios pedidos e ingressos, recebe avisos |

O cadastro público nunca cria um ADM; o administrador inicial vem de `ADMIN_EMAIL` /
`ADMIN_SENHA`, de forma idempotente, na subida do Gateway.

## Tolerância a falhas (validada em 19/11/2026)

| Serviço parado | O que continua | O que a interface faz | Ao voltar |
|---|---|---|---|
| `pagamento` | Catálogo, ingressos já emitidos, check-in, cancelamentos | A tela de compra deixa de oferecer meios de pagamento, explica a indisponibilidade e bloqueia o botão; tenta de novo a cada 8 s e se libera sozinha. Em Pedidos, o pagamento aparece como indisponível e o resto do pedido segue visível | Pedido já feito (`AGUARDANDO_PAGAMENTO`) retoma pela fila e conclui. Se passar de `PEDIDO_EXPIRA_SEGUNDOS` (120 s), o pedido expira e libera os lugares; pagamento aprovado depois disso gera estorno |
| `notificacoes` | Compra de ponta a ponta, tudo o mais | Tela de Avisos mostra que o serviço não respondeu e que as demais páginas seguem normais; o contador do sino fica quieto | Os eventos retidos na fila durável são entregues e os avisos aparecem |

Mecanismos: Circuit Breaker no Gateway (resposta 502 com a mensagem do serviço fora),
fila durável + Outbox (nada se perde), consumidores idempotentes (reentrega segura) e
expiração independente do Pagamento (a reserva nunca fica presa).

Teste feito com `docker compose stop` e `start`: com notificações parado, a compra foi
a `CONCLUIDO` com 1 ingresso e a fila reteve 1 mensagem, entregue em segundos após o
`start`; com pagamento parado, o catálogo respondeu 200, o pedido ficou em
`AGUARDANDO_PAGAMENTO` e, após o `start`, concluiu com 1 ingresso.

## Demonstração (15–20 min)

1. Cadastro e login (participante e organizador) — autenticação no Gateway.
2. Organizador cria evento, setores e lotes; publica e abre as vendas.
3. Participante compra: pedido **202**, Saga roda, ingresso emitido, aviso chega.
4. Pagamento recusado de propósito (gatilho determinístico) → compensação: lugares
   liberados, pedido cancelado, comprador avisado.
5. Validação do ingresso na entrada; segunda tentativa é recusada.
6. Cancelamento do evento → ingressos invalidados, estorno, avisos a todos os compradores.
7. **Tolerância a falhas**: `docker compose stop pagamento` e `stop notificacoes`,
   mostrando o resto do sistema funcionando e os avisos chegando depois.
