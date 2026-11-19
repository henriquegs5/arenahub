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
| `evento.alterado.v1` | EventoAlterado | Eventos | Ingressos |
| `evento.cancelado.v1` | EventoCancelado | Eventos | Eventos, Ingressos |
| `compra.solicitada.v1` | CompraSolicitada | Ingressos | Eventos |
| `lugares.reservados.v1` | LugaresReservados | Eventos | Ingressos |
| `reserva.recusada.v1` | ReservaRecusada | Eventos | Ingressos |
| `pagamento.solicitado.v1` | PagamentoSolicitado | Ingressos | Pagamento |
| `pagamento.aprovado.v1` | PagamentoAprovado | Pagamento | Ingressos |
| `pagamento.recusado.v1` | PagamentoRecusado | Pagamento | Ingressos, Notificacoes |
| `ingresso.emitido.v1` | IngressoEmitido | Ingressos | Notificacoes |
| `pedido.cancelado.v1` | PedidoCancelado | Ingressos | Eventos, Notificacoes |
| `estorno.solicitado.v1` | EstornoSolicitado | Ingressos | Pagamento |
| `estorno.concluido.v1` | EstornoConcluido | Pagamento | Ingressos, Notificacoes |
| `lugares.liberados.v1` | LugaresLiberados | Eventos | — (rastro de auditoria) |
| `ingressos.afetados.v1` | IngressosAfetados | Ingressos | Notificacoes |

> A coerência entre este catálogo, os JSON Schemas e o que cada serviço declara
> em `PUBLISHES`/`SUBSCRIBES` é conferida por `python scripts/check-contratos.py`.

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

## Publicados por Eventos

Os dois eventos abaixo saem **sem destinatários**. Quem sabe *quem comprou ingresso*
para um evento é o serviço de **Ingressos**, não o de Eventos. Em vez de Eventos
consultar Ingressos por HTTP — o que acoplaria os dois —, Ingressos consome estes
eventos, resolve os titulares que só ele conhece e publica o aviso nominal.

### EventoAlterado — `evento.alterado.v1`
Nome, data ou local de um evento mudou. É a "atualização de última hora" citada pelo
enunciado. Alterar apenas a descrição **não** gera evento: não muda nada para quem comprou.

Publica: Eventos · Consome: Ingressos

| Campo do payload | Descrição |
|---|---|
| `eventoId` | UUID |
| `nome` | texto (valor já atualizado) |
| `dataHora` | data/hora ISO-8601 (valor já atualizado) |
| `local` | texto (valor já atualizado) |
| `alteracoes` | lista com os campos que mudaram: `nome`, `data`, `local` |
| `organizadorId` | UUID |
| `destinatarios` | sai vazia; Ingressos republica o aviso nominal |

### EventoCancelado — `evento.cancelado.v1`
Um evento foi cancelado. Inicia a cadeia de compensação: Ingressos invalida os
ingressos e pede o estorno, Pagamento estorna, Notificações avisa os compradores.

Publica: Eventos · Consome: Ingressos

| Campo do payload | Descrição |
|---|---|
| `eventoId` | UUID |
| `nome` | texto |
| `dataHora` | data/hora ISO-8601 |
| `local` | texto |
| `motivo` | texto informado pelo organizador |
| `organizadorId` | UUID |
| `destinatarios` | sai vazia; Ingressos republica o aviso nominal |

## A Saga da compra

> **Serviço consumidor parado.** O broker retém `pagamento.solicitado` (ou qualquer
> evento) na fila durável do consumidor e o entrega quando ele volta; a idempotência
> por `eventos_processados` torna a reentrega segura. Se Pagamento ficar fora além do
> prazo do pedido, o varredor de Ingressos expira o pedido (`pedido.cancelado`) e, se o
> pagamento for aprovado depois, `estorno.solicitado` devolve o valor. Nenhum contrato
> mudou no lote 7. Ver `docs/01-planejamento.md`, "Tolerância a falhas".


```
 Comprador
    │  POST /api/ingressos/pedidos            → HTTP 202 (pedido PENDENTE)
    ▼
 INGRESSOS ──compra.solicitada──▶ EVENTOS
                                     │ Chain of Responsibility:
                                     │ vendas abertas? lote vigente? há lugar?
                                     │ reserva ATÔMICA + grava `reservas`
                    ┌────────────────┴────────────────┐
         lugares.reservados                   reserva.recusada
                    │                                 │
                    ▼                                 ▼
 INGRESSOS (RESERVADO)                    INGRESSOS (RECUSADO) ── fim
    │  pagamento.solicitado
    ▼
 PAGAMENTO  (Adapter do provedor simulado + Strategy do meio)
    ├── pagamento.aprovado ──▶ INGRESSOS emite ──ingresso.emitido──▶ NOTIFICAÇÕES
    └── pagamento.recusado ──▶ INGRESSOS encerra o pedido
                                   │  pedido.cancelado
                                   ▼
                               EVENTOS devolve os lugares ──lugares.liberados──▶
```

### Compensação

Toda compensação passa por `pedido.cancelado` (devolve lugares) e, quando já
houve cobrança aprovada, por `estorno.solicitado` (devolve o dinheiro). O mesmo
caminho serve para **pagamento recusado**, **expiração**, **cancelamento pelo
comprador** e **cancelamento do evento** — muda só o motivo.

### Expiração: a saída para o pedido que trava

Um pedido pode ficar preso porque uma resposta da Saga se perdeu ou porque o
serviço de Pagamento está fora do ar. Sem saída, os lugares ficariam reservados
para sempre e o evento esgotaria sem ter vendido.

O serviço de Ingressos roda um **varredor** (`PEDIDO_EXPIRA_SEGUNDOS`, padrão
120s) que encerra os pedidos vencidos e publica `pedido.cancelado`. Ele vive
dentro do próprio serviço e **não depende de Pagamento**: com o pagamento
parado, o pedido expira do mesmo jeito e os lugares voltam ao estoque.

Pedidos em `PAGO` ficam de fora: dinheiro que já entrou se resolve concluindo a
emissão, nunca expirando.

### Idempotência das compensações

Além do `eventos_processados` de cada serviço, cada compensação tem uma defesa
no próprio dado:

| Compensação | O que a torna idempotente |
|---|---|
| Liberar lugares | Tabela `reservas` em Eventos: só libera uma reserva `ATIVA`, e a marca `LIBERADA`. Repetir não devolve lugares duas vezes, e um pedido que expirou **antes** de reservar não devolve nada. |
| Cobrar | `transacoes.pedido_id` é `UNIQUE` em Pagamento. Reentrega não cobra de novo: republica o desfecho já decidido. |
| Estornar | Transação já `ESTORNADO` não é estornada outra vez; pedido sem cobrança aprovada não gera movimento. |
| Encerrar pedido | O State recusa a transição a partir de um estado final, e o comando é ignorado. |
| Validar entrada | `UPDATE ... WHERE status = 'EMITIDO'`: a segunda leitura do mesmo QR não passa. |

## Publicados por Ingressos

### CompraSolicitada — `compra.solicitada.v1`
Passo 1 da Saga: o pedido nasce `PENDENTE`.

Publica: Ingressos · Consome: Eventos

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `eventoId`, `compradorId` | UUID |
| `itens` | lista de `{loteId, quantidade, politica}` |
| `destinatarios` | vazia (evento interno da Saga) |

### PagamentoSolicitado — `pagamento.solicitado.v1`
Passo 3: lugares reservados, cobrança pedida.

**Segurança:** trafega apenas `referenciaPagamento`, um token opaco. Número de
cartão, CVV e validade nunca entram neste sistema.

Publica: Ingressos · Consome: Pagamento

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `eventoId`, `compradorId` | UUID |
| `valorCentavos` | inteiro, em centavos |
| `meio` | `PIX` / `CARTAO_CREDITO` / `BOLETO` / `CARTAO_RECUSADO` |
| `referenciaPagamento` | token opaco do meio de pagamento |
| `eventoNome` | nome legível, para o aviso |
| `destinatarios` | vazia |

### IngressoEmitido — `ingresso.emitido.v1`
Passo 5: pagamento aprovado e ingressos digitais emitidos.

Publica: Ingressos · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `eventoId`, `compradorId` | UUID |
| `eventoNome`, `eventoDataHora`, `eventoLocal` | nomes legíveis, para o aviso |
| `totalCentavos` | inteiro, em centavos |
| `ingressos` | lista de `{ingressoId, codigo, setorNome, loteNome, politica}` |
| `destinatarios` | o comprador |

### PedidoCancelado — `pedido.cancelado.v1`
Compensação: o pedido foi encerrado sem concluir.

Publica: Ingressos · Consome: Eventos (devolve os lugares), Notificacoes

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `eventoId`, `compradorId` | UUID |
| `motivo` | texto |
| `situacao` | `RECUSADO` / `EXPIRADO` / `CANCELADO` |
| `eventoNome` | nome legível |
| `itens` | lista de `{loteId, quantidade}` a devolver |
| `destinatarios` | o comprador |

### EstornoSolicitado — `estorno.solicitado.v1`
Compensação: um pedido já pago foi cancelado e precisa de estorno.

Publica: Ingressos · Consome: Pagamento

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `eventoId`, `compradorId` | UUID |
| `motivo`, `eventoNome` | texto |
| `destinatarios` | vazia |

### IngressosAfetados — `ingressos.afetados.v1`
Os titulares de ingresso de um evento alterado precisam ser avisados.

**Por que existe:** o serviço de Eventos publica `evento.alterado` **sem
destinatários**, porque não sabe quem comprou. Ingressos sabe, e é ele quem
resolve a lista. Assim nenhum serviço precisa consultar o outro.

Publica: Ingressos · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `eventoId` | UUID |
| `eventoNome`, `dataHora`, `local` | valores já atualizados |
| `alteracoes` | `nome`, `data`, `local` |
| `quantidadeTitulares` | inteiro |
| `destinatarios` | todos os titulares de ingresso válido |

## Publicados por Eventos (Saga)

### LugaresReservados — `lugares.reservados.v1`
Passo 2: os lugares foram reservados.

Carrega os **nomes legíveis** (evento, setor, lote) e os **preços já calculados**
pela Strategy de preço, para que Ingressos e Notificações não precisem consultar
este serviço.

Publica: Eventos · Consome: Ingressos

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `eventoId`, `compradorId` | UUID |
| `organizadorId` | UUID, opcional (compatível com a v1): dono do evento, para Ingressos saber quem valida na entrada |
| `eventoNome`, `eventoDataHora`, `eventoLocal` | nomes legíveis |
| `itens` | `{loteId, setorNome, loteNome, quantidade, politica, precoUnitarioCentavos}` |
| `totalCentavos` | inteiro, em centavos |
| `destinatarios` | vazia |

### ReservaRecusada — `reserva.recusada.v1`
Compensação: não foi possível reservar. **Nada** foi reservado.

Publica: Eventos · Consome: Ingressos

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `eventoId`, `compradorId` | UUID |
| `eventoNome` | nome legível |
| `motivo` | o elo da Chain que recusou |
| `destinatarios` | vazia |

### LugaresLiberados — `lugares.liberados.v1`
Confirmação da compensação: os lugares voltaram ao estoque. Só é publicado
quando havia uma reserva `ATIVA`, então repetir a compensação não devolve
lugares duas vezes.

Publica: Eventos · Consome: ninguém hoje — é rastro para a demonstração e a auditoria.

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `eventoId` | UUID |
| `motivo` | texto |
| `itens` | lista de `{loteId, quantidade}` |
| `destinatarios` | vazia |

## Publicados por Pagamento

### PagamentoAprovado — `pagamento.aprovado.v1`
Passo 4: a cobrança foi autorizada.

Publica: Pagamento · Consome: Ingressos

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `transacaoId`, `eventoId`, `compradorId` | UUID |
| `valorCentavos` | inteiro, em centavos |
| `meio` | meio de pagamento |
| `autorizacao` | código de autorização do provedor |
| `destinatarios` | vazia |

### PagamentoRecusado — `pagamento.recusado.v1`
Compensação: a cobrança não foi autorizada.

Publica: Pagamento · Consome: Ingressos, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `transacaoId`, `eventoId`, `compradorId` | UUID |
| `valorCentavos` | inteiro, em centavos |
| `meio` | meio de pagamento |
| `motivo` | por que o provedor recusou |
| `eventoNome` | nome legível |
| `destinatarios` | o comprador |

### EstornoConcluido — `estorno.concluido.v1`
Compensação concluída: o valor foi estornado.

`automatico: false` quando o meio não estorna sozinho (boleto); o reembolso fica
registrado para tratamento manual.

Publica: Pagamento · Consome: Ingressos, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `pedidoId`, `transacaoId`, `eventoId`, `compradorId` | UUID |
| `valorCentavos` | inteiro, em centavos |
| `automatico` | booleano |
| `motivo`, `eventoNome` | texto |
| `destinatarios` | o comprador |
