# ArenaHub — Contratos de eventos (v1)

## Regras
- Broker: RabbitMQ, exchange `arenahub.events` (tipo *topic*, durável).
- Routing key: `<nome>.v<versão>` (ex.: `resultado.confirmado.v1`).
- Cada serviço tem uma fila própria (`<servico>.events`) ligada às routing keys que consome.
- Mudança que quebra compatibilidade = nova versão (`.v2`); a `.v1` continua até todos migrarem.
- Consumidores são **idempotentes** (descartam `eventId` já processado).
- Não existe biblioteca de domínio compartilhada: o contrato é o JSON Schema em `contracts/events/`.

## Envelope (todos os eventos)
| Campo | Descrição |
|---|---|
| `eventId` | UUID único do evento (base da idempotência) |
| `type` | nome do evento (ex.: `resultado.confirmado`) |
| `version` | inteiro (1) |
| `occurredAt` | data/hora ISO-8601 |
| `correlationId` | mesmo ID do pedido HTTP que originou o fluxo |
| `producer` | serviço que publicou |
| `payload` | dados específicos do evento |

## Catálogo
| Evento | Nome técnico | Publica | Consome |
|---|---|---|---|
| `usuario.registrado.v1` | UsuarioRegistrado | Identidade | Notificações |
| `equipe.criada.v1` | EquipeCriada | Equipes | Ranking |
| `equipe.atualizada.v1` | EquipeAtualizada | Equipes | Ranking |
| `inscricao.solicitada.v1` | InscricaoSolicitada | Torneios | Equipes |
| `equipe.validada.v1` | EquipeValidada | Equipes | Torneios, Ranking |
| `equipe.rejeitada.v1` | EquipeRejeitada | Equipes | Torneios |
| `confrontos.gerados.v1` | ConfrontosGerados | Torneios | Partidas |
| `resultado.informado.v1` | ResultadoInformado | Partidas | Notificações |
| `resultado.confirmado.v1` | ResultadoConfirmado | Partidas | Torneios, Ranking, Notificações |
| `resultado.contestado.v1` | ResultadoContestado | Partidas | Notificações |
| `torneio.finalizado.v1` | TorneioFinalizado | Torneios | Ranking, Notificações |

### UsuarioRegistrado — `usuario.registrado.v1`
Publica: Identidade · Consome: Notificações

| Campo | Tipo |
|---|---|
| `usuarioId` | string |
| `nome` | string |
| `email` | string |
| `papel` | JOGADOR ou ORGANIZADOR |

### EquipeCriada — `equipe.criada.v1`
Publica: Equipes · Consome: Ranking

| Campo | Tipo |
|---|---|
| `equipeId` | string |
| `nome` | string |
| `capitaoId` | string |

### EquipeAtualizada — `equipe.atualizada.v1`
Publica: Equipes · Consome: Ranking

| Campo | Tipo |
|---|---|
| `equipeId` | string |
| `nome` | string |

### InscricaoSolicitada — `inscricao.solicitada.v1`
Publica: Torneios · Consome: Equipes

| Campo | Tipo |
|---|---|
| `inscricaoId` | string |
| `torneioId` | string |
| `equipeId` | string |
| `solicitanteId` | string |

### EquipeValidada — `equipe.validada.v1`
Publica: Equipes · Consome: Torneios, Ranking

| Campo | Tipo |
|---|---|
| `inscricaoId` | string |
| `torneioId` | string |
| `equipeId` | string |
| `nomeEquipe` | string |

### EquipeRejeitada — `equipe.rejeitada.v1`
Publica: Equipes · Consome: Torneios

| Campo | Tipo |
|---|---|
| `inscricaoId` | string |
| `torneioId` | string |
| `equipeId` | string |
| `motivo` | string |

### ConfrontosGerados — `confrontos.gerados.v1`
Publica: Torneios · Consome: Partidas

| Campo | Tipo |
|---|---|
| `torneioId` | string |
| `formato` | ELIMINACAO_SIMPLES ou PONTOS_CORRIDOS |
| `organizadorId` | string |
| `partidas` | lista de {partidaId, rodada, equipeAId, equipeBId, capitaoAId, capitaoBId} |

### ResultadoInformado — `resultado.informado.v1`
Publica: Partidas · Consome: Notificações

| Campo | Tipo |
|---|---|
| `partidaId` | string |
| `torneioId` | string |
| `informadoPor` | string |
| `placarA` | integer |
| `placarB` | integer |

### ResultadoConfirmado — `resultado.confirmado.v1`
Publica: Partidas · Consome: Torneios, Ranking, Notificações

| Campo | Tipo |
|---|---|
| `partidaId` | string |
| `torneioId` | string |
| `rodada` | integer |
| `equipeAId` | string |
| `equipeBId` | string |
| `placarA` | integer |
| `placarB` | integer |
| `vencedorId` | string|null |

### ResultadoContestado — `resultado.contestado.v1`
Publica: Partidas · Consome: Notificações

| Campo | Tipo |
|---|---|
| `partidaId` | string |
| `torneioId` | string |
| `contestadoPor` | string |
| `motivo` | string |

### TorneioFinalizado — `torneio.finalizado.v1`
Publica: Torneios · Consome: Ranking, Notificações

| Campo | Tipo |
|---|---|
| `torneioId` | string |
| `campeaoId` | string |
| `formato` | ELIMINACAO_SIMPLES ou PONTOS_CORRIDOS |
