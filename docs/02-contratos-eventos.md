# ArenaHub — Contratos de eventos (v1)

> Documento gerado a partir da mesma especificação que produz os JSON Schemas em
> `contracts/events/`. Schema e documentação não divergem.

## Regras
- Broker: RabbitMQ, exchange `arenahub.events` (tipo *topic*, durável).
- Routing key: `<nome>.v<versão>` (ex.: `ingresso.emitido.v1`).
- Cada serviço tem uma fila própria (`<servico>.events`) ligada às routing keys que consome.
- Toda fila aponta para uma **dead letter** própria (`<servico>.events.dlq`, via exchange
  `arenahub.events.dlx`). Mensagem com falha permanente para ali e pode ser inspecionada
  e reprocessada pelo administrador — nunca desaparece em silêncio.
- Mudança que quebra compatibilidade = nova versão (`.v2`); a `.v1` continua até todos migrarem.
  Acrescentar campo opcional é compatível e **não** exige nova versão.
- Consumidores são **idempotentes** (descartam `eventId` já processado).
- Produtores usam **Transactional Outbox**: o evento é gravado na mesma transação do fato
  (tabela `eventos_saida`) e entregue ao broker depois do commit, com repetição até conseguir.
- Não existe biblioteca de domínio compartilhada: o contrato é o JSON Schema em `contracts/events/`.

## Envelope (todos os eventos)
| Campo | Descrição |
|---|---|
| `eventId` | UUID único do evento (base da idempotência) |
| `type` | nome do evento (ex.: `ingresso.emitido`) |
| `version` | inteiro (1) |
| `occurredAt` | data/hora ISO-8601 — é por ela que o feed de avisos é ordenado |
| `correlationId` | mesmo ID do pedido HTTP que originou o fluxo |
| `producer` | serviço que publicou |
| `payload` | dados específicos do evento |

## Destinatários dos avisos
O serviço de Notificações **não** consulta Eventos, Ingressos nem o Gateway para descobrir
quem avisar — isso acoplaria os serviços. Quem publica o evento conhece as pessoas
envolvidas no fato, então o próprio payload carrega `destinatarios` (IDs de usuário) e os
**nomes legíveis** necessários para montar a mensagem (nome do evento, do setor, do lote).

## Catálogo

| Evento | Classe | Publica | Consome |
|---|---|---|---|
| `usuario.registrado.v1` | UsuarioRegistrado | Gateway | Notificacoes |
| `usuario.atualizado.v1` | UsuarioAtualizado | Gateway | Notificacoes, Eventos, Ingressos |
| `usuario.removido.v1` | UsuarioRemovido | Gateway | Eventos, Ingressos, Notificacoes |

> Os eventos do domínio de ingressos — `compra.solicitada`, `lugares.reservados`,
> `reserva.recusada`, `pagamento.solicitado`, `pagamento.aprovado`, `pagamento.recusado`,
> `ingresso.emitido`, `evento.alterado`, `evento.cancelado`, `estorno.concluido` — são
> especificados e implementados nos lotes 2 a 5, cada um com o seu JSON Schema em
> `contracts/events/` e a sua linha neste catálogo.

## Publicados pelo Gateway

A autenticação vive dentro do API Gateway (ver `README.md`, "Decisões de arquitetura"),
por isso o `producer` destes três eventos é `gateway`. Eles são o único ponto em que os
serviços de domínio tomam conhecimento de contas de usuário: nenhum deles acessa o
`gateway_db`, e cada um guarda apenas o **ID** do usuário mais a cópia do nome que chegou
por evento.

### UsuarioRegistrado — `usuario.registrado.v1`
Uma conta foi criada.

Publica: Gateway · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `usuarioId` | UUID |
| `nome` | texto |
| `email` | texto |
| `papel` | `PARTICIPANTE` / `ORGANIZADOR` / `ADM` |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### UsuarioAtualizado — `usuario.atualizado.v1`
Nome ou papel de uma conta mudou. Permite que os outros serviços mantenham a cópia do nome em dia.

Publica: Gateway · Consome: Notificacoes, Eventos, Ingressos

| Campo do payload | Descrição |
|---|---|
| `usuarioId` | UUID |
| `nome` | texto |
| `papel` | `PARTICIPANTE` / `ORGANIZADOR` / `ADM` |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### UsuarioRemovido — `usuario.removido.v1`
Uma conta foi excluída. Dispara as compensações nos demais serviços: os ingressos do
titular e os eventos de que ele era organizador.

Publica: Gateway · Consome: Eventos, Ingressos, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `usuarioId` | UUID |
| `nome` | texto |
| `papel` | `PARTICIPANTE` / `ORGANIZADOR` / `ADM` (opcional; acrescentado na migração, compatível com a v1) |
| `removidoPor` | UUID |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |
