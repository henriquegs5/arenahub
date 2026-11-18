# ArenaHub — Contratos de eventos (v1)

> Documento gerado a partir da mesma especificação que produz os JSON Schemas em
> `contracts/events/`. Schema e documentação não divergem.

## Regras
- Broker: RabbitMQ, exchange `arenahub.events` (tipo *topic*, durável).
- Routing key: `<nome>.v<versão>` (ex.: `resultado.confirmado.v1`).
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
| `type` | nome do evento (ex.: `resultado.confirmado`) |
| `version` | inteiro (1) |
| `occurredAt` | data/hora ISO-8601 — é por ela que o feed de avisos é ordenado |
| `correlationId` | mesmo ID do pedido HTTP que originou o fluxo |
| `producer` | serviço que publicou |
| `payload` | dados específicos do evento |

## Destinatários dos avisos
O serviço de Notificações **não** consulta o serviço de Equipes para descobrir quem avisar —
isso acoplaria os dois. Quem publica o evento conhece as pessoas envolvidas no fato, então o
próprio payload carrega `destinatarios` (IDs de usuário) e os **nomes legíveis** necessários
para montar a mensagem. Um único evento sem destinatários nominais, `inscricoes.abertas`,
traz `geral: true` e vira um aviso visível a todos.

## Catálogo
| Evento | Classe | Publica | Consome |
|---|---|---|---|
| `usuario.registrado.v1` | UsuarioRegistrado | Identidade | Notificacoes, Equipes |
| `usuario.atualizado.v1` | UsuarioAtualizado | Identidade | Equipes, Notificacoes |
| `usuario.removido.v1` | UsuarioRemovido | Identidade | Equipes, Torneios, Notificacoes |
| `equipe.criada.v1` | EquipeCriada | Equipes | Ranking, Notificacoes |
| `equipe.atualizada.v1` | EquipeAtualizada | Equipes | Ranking, Notificacoes |
| `equipe.removida.v1` | EquipeRemovida | Equipes | Torneios, Partidas, Ranking, Notificacoes |
| `solicitacao.criada.v1` | SolicitacaoCriada | Equipes | Notificacoes |
| `solicitacao.resolvida.v1` | SolicitacaoResolvida | Equipes | Notificacoes |
| `membro.entrou.v1` | MembroEntrou | Equipes | Notificacoes |
| `membro.saiu.v1` | MembroSaiu | Equipes | Notificacoes |
| `capitania.transferida.v1` | CapitaniaTransferida | Equipes | Torneios, Partidas, Notificacoes |
| `equipe.validada.v1` | EquipeValidada | Equipes | Torneios, Ranking |
| `equipe.rejeitada.v1` | EquipeRejeitada | Equipes | Torneios |
| `inscricao.solicitada.v1` | InscricaoSolicitada | Torneios | Equipes |
| `inscricoes.abertas.v1` | InscricoesAbertas | Torneios | Notificacoes |
| `inscricao.resolvida.v1` | InscricaoResolvida | Torneios | Equipes, Notificacoes |
| `confrontos.gerados.v1` | ConfrontosGerados | Torneios | Partidas, Notificacoes |
| `torneio.cancelado.v1` | TorneioCancelado | Torneios | Equipes, Partidas, Ranking, Notificacoes |
| `torneio.removido.v1` | TorneioRemovido | Torneios | Partidas, Ranking, Notificacoes |
| `torneio.finalizado.v1` | TorneioFinalizado | Torneios | Equipes, Ranking, Notificacoes |
| `resultado.informado.v1` | ResultadoInformado | Partidas | Notificacoes |
| `resultado.confirmado.v1` | ResultadoConfirmado | Partidas | Torneios, Ranking, Notificacoes |
| `resultado.contestado.v1` | ResultadoContestado | Partidas | Notificacoes |
| `resultado.corrigido.v1` | ResultadoCorrigido | Partidas | Torneios, Ranking, Notificacoes |
| `partida.cancelada.v1` | PartidaCancelada | Partidas | Torneios, Ranking, Notificacoes |
| `partida.agendada.v1` | PartidaAgendada | Partidas | Notificacoes |

## Publicados por Identidade

### UsuarioRegistrado — `usuario.registrado.v1`
Uma conta foi criada.

Publica: Identidade · Consome: Notificacoes, Equipes

| Campo do payload | Descrição |
|---|---|
| `usuarioId` | UUID |
| `nome` | texto |
| `email` | texto |
| `papel` | `JOGADOR` / `ORGANIZADOR` / `ADM` |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### UsuarioAtualizado — `usuario.atualizado.v1`
Nome ou papel de uma conta mudou. Permite que os outros serviços mantenham a cópia do nome em dia.

Publica: Identidade · Consome: Equipes, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `usuarioId` | UUID |
| `nome` | texto |
| `papel` | `JOGADOR` / `ORGANIZADOR` / `ADM` |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### UsuarioRemovido — `usuario.removido.v1`
Uma conta foi excluída. Dispara as compensações nos demais serviços.

Publica: Identidade · Consome: Equipes, Torneios, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `usuarioId` | UUID |
| `nome` | texto |
| `removidoPor` | UUID |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

## Publicados por Equipes

### EquipeCriada — `equipe.criada.v1`
Uma equipe foi criada; quem criou entra como capitão.

Publica: Equipes · Consome: Ranking, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `equipeId` | UUID |
| `nome` | texto |
| `capitaoId` | UUID |
| `capitaoNome` | texto |
| `membros` | lista de UUIDs |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### EquipeAtualizada — `equipe.atualizada.v1`
O nome da equipe mudou.

Publica: Equipes · Consome: Ranking, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `equipeId` | UUID |
| `nome` | texto |
| `nomeAnterior` | texto *(opcional)* |
| `membros` | lista de UUIDs |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### EquipeRemovida — `equipe.removida.v1`
A equipe foi desfeita. Torneios cancela as inscrições e libera as vagas.

Publica: Equipes · Consome: Torneios, Partidas, Ranking, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `equipeId` | UUID |
| `nome` | texto |
| `capitaoId` | UUID |
| `motivo` | texto |
| `membros` | lista de UUIDs |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### SolicitacaoCriada — `solicitacao.criada.v1`
Um jogador pediu para entrar numa equipe. Avisa o capitão.

Publica: Equipes · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `solicitacaoId` | UUID |
| `equipeId` | UUID |
| `nomeEquipe` | texto |
| `usuarioId` | UUID |
| `nomeUsuario` | texto |
| `capitaoId` | UUID |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### SolicitacaoResolvida — `solicitacao.resolvida.v1`
A solicitação foi aceita, recusada ou cancelada pelo próprio solicitante.

Publica: Equipes · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `solicitacaoId` | UUID |
| `equipeId` | UUID |
| `nomeEquipe` | texto |
| `usuarioId` | UUID |
| `nomeUsuario` | texto |
| `status` | `ACEITA` / `RECUSADA` / `CANCELADA` |
| `resolvidoPor` | UUID |
| `motivo` | texto *(opcional)* |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### MembroEntrou — `membro.entrou.v1`
Um jogador passou a integrar a equipe.

Publica: Equipes · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `equipeId` | UUID |
| `nomeEquipe` | texto |
| `usuarioId` | UUID |
| `nomeUsuario` | texto |
| `membros` | lista de UUIDs |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### MembroSaiu — `membro.saiu.v1`
Um jogador deixou a equipe (saída própria, remoção pelo capitão ou conta excluída).

Publica: Equipes · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `equipeId` | UUID |
| `nomeEquipe` | texto |
| `usuarioId` | UUID |
| `nomeUsuario` | texto |
| `motivo` | `SAIDA` / `REMOCAO` / `CONTA_REMOVIDA` |
| `membros` | lista de UUIDs |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### CapitaniaTransferida — `capitania.transferida.v1`
A equipe passou a ter outro capitão. Torneios e Partidas atualizam quem pode agir pela equipe.

Publica: Equipes · Consome: Torneios, Partidas, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `equipeId` | UUID |
| `nomeEquipe` | texto |
| `capitaoAnteriorId` | UUID |
| `capitaoAnteriorNome` | texto |
| `capitaoNovoId` | UUID |
| `capitaoNovoNome` | texto |
| `membros` | lista de UUIDs |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### EquipeValidada — `equipe.validada.v1`
Resposta da Saga de inscrição: a equipe é elegível. Carrega os membros para que o Torneios saiba a quem avisar.

Publica: Equipes · Consome: Torneios, Ranking

| Campo do payload | Descrição |
|---|---|
| `inscricaoId` | UUID |
| `torneioId` | UUID |
| `equipeId` | UUID |
| `nomeEquipe` | texto |
| `capitaoId` | UUID |
| `membros` | lista de UUIDs |

### EquipeRejeitada — `equipe.rejeitada.v1`
Resposta da Saga de inscrição: a equipe não é elegível. O Torneios compensa e libera a vaga.

Publica: Equipes · Consome: Torneios

| Campo do payload | Descrição |
|---|---|
| `inscricaoId` | UUID |
| `torneioId` | UUID |
| `equipeId` | UUID |
| `nomeEquipe` | texto *(opcional)* |
| `capitaoId` | UUID *(opcional)* |
| `motivo` | texto |

## Publicados por Torneios

### InscricaoSolicitada — `inscricao.solicitada.v1`
Início da Saga de inscrição. `tentativa` cresce quando o Torneios reenvia um pedido sem resposta.

Publica: Torneios · Consome: Equipes

| Campo do payload | Descrição |
|---|---|
| `inscricaoId` | UUID |
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `equipeId` | UUID |
| `solicitanteId` | UUID |
| `tentativa` | inteiro |

### InscricoesAbertas — `inscricoes.abertas.v1`
Um torneio passou a aceitar inscrições. Vira aviso geral (o publicador não conhece a lista de jogadores).

Publica: Torneios · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `formato` | `ELIMINACAO_SIMPLES` / `PONTOS_CORRIDOS` |
| `maxEquipes` | inteiro |
| `organizadorId` | UUID |
| `geral` | booleano |

### InscricaoResolvida — `inscricao.resolvida.v1`
Desfecho de uma inscrição. Equipes usa para saber se a equipe tem compromisso ativo; Notificações avisa o capitão.

Publica: Torneios · Consome: Equipes, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `inscricaoId` | UUID |
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `equipeId` | UUID |
| `nomeEquipe` | texto |
| `capitaoId` | UUID *(opcional)* |
| `status` | `CONFIRMADA` / `REJEITADA` / `CANCELADA` |
| `motivo` | texto *(opcional)* |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### ConfrontosGerados — `confrontos.gerados.v1`
A chave (ou a rodada seguinte) foi sorteada. Partidas cria os jogos; Notificações avisa os integrantes.

Publica: Torneios · Consome: Partidas, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `formato` | `ELIMINACAO_SIMPLES` / `PONTOS_CORRIDOS` |
| `organizadorId` | UUID |
| `partidas` | confrontos da rodada |
| `partidas[].partidaId` | UUID |
| `partidas[].rodada` | inteiro |
| `partidas[].equipeAId` | UUID |
| `partidas[].nomeEquipeA` | texto |
| `partidas[].equipeBId` | UUID |
| `partidas[].nomeEquipeB` | texto |
| `partidas[].capitaoAId` | UUID |
| `partidas[].capitaoBId` | UUID |
| `partidas[].integrantes` | lista de UUIDs |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### TorneioCancelado — `torneio.cancelado.v1`
O torneio foi cancelado. Partidas cancela os jogos pendentes e o Ranking descarta os resultados dele.

Publica: Torneios · Consome: Equipes, Partidas, Ranking, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `organizadorId` | UUID |
| `motivo` | texto |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### TorneioRemovido — `torneio.removido.v1`
O torneio foi excluído (só é possível em RASCUNHO ou CANCELADO). Os serviços apagam o que derivaram dele.

Publica: Torneios · Consome: Partidas, Ranking, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### TorneioFinalizado — `torneio.finalizado.v1`
O torneio terminou e tem campeã.

Publica: Torneios · Consome: Equipes, Ranking, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `campeaoId` | UUID |
| `nomeCampeao` | texto |
| `formato` | `ELIMINACAO_SIMPLES` / `PONTOS_CORRIDOS` |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

## Publicados por Partidas

### ResultadoInformado — `resultado.informado.v1`
Um capitão informou o placar; falta a confirmação do organizador.

Publica: Partidas · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `partidaId` | UUID |
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `rodada` | inteiro |
| `equipeAId` | UUID |
| `equipeBId` | UUID |
| `nomeEquipeA` | texto |
| `nomeEquipeB` | texto |
| `informadoPor` | UUID |
| `placarA` | inteiro |
| `placarB` | inteiro |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### ResultadoConfirmado — `resultado.confirmado.v1`
O placar virou oficial. O Torneios avança a chave e o Ranking soma os pontos.

Publica: Partidas · Consome: Torneios, Ranking, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `partidaId` | UUID |
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `rodada` | inteiro |
| `equipeAId` | UUID |
| `equipeBId` | UUID |
| `nomeEquipeA` | texto |
| `nomeEquipeB` | texto |
| `placarA` | inteiro |
| `placarB` | inteiro |
| `vencedorId` | UUID *(opcional)* |
| `nomeVencedor` | texto *(opcional)* |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### ResultadoContestado — `resultado.contestado.v1`
O capitão adversário contestou o placar informado; cabe ao organizador resolver.

Publica: Partidas · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `partidaId` | UUID |
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `nomeEquipeA` | texto |
| `nomeEquipeB` | texto |
| `contestadoPor` | UUID |
| `motivo` | texto |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### ResultadoCorrigido — `resultado.corrigido.v1`
O organizador corrigiu um placar já confirmado. Só existe em PONTOS_CORRIDOS, onde cada jogo é independente.

Publica: Partidas · Consome: Torneios, Ranking, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `partidaId` | UUID |
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `rodada` | inteiro |
| `equipeAId` | UUID |
| `equipeBId` | UUID |
| `nomeEquipeA` | texto |
| `nomeEquipeB` | texto |
| `placarA` | inteiro |
| `placarB` | inteiro |
| `vencedorId` | UUID *(opcional)* |
| `justificativa` | texto |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### PartidaCancelada — `partida.cancelada.v1`
A partida não será disputada (cancelada pelo organizador, equipe desfeita ou torneio cancelado).

Publica: Partidas · Consome: Torneios, Ranking, Notificacoes

| Campo do payload | Descrição |
|---|---|
| `partidaId` | UUID |
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `equipeAId` | UUID |
| `equipeBId` | UUID |
| `nomeEquipeA` | texto |
| `nomeEquipeB` | texto |
| `motivo` | texto |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

### PartidaAgendada — `partida.agendada.v1`
O organizador definiu ou mudou a data prevista da partida.

Publica: Partidas · Consome: Notificacoes

| Campo do payload | Descrição |
|---|---|
| `partidaId` | UUID |
| `torneioId` | UUID |
| `nomeTorneio` | texto |
| `nomeEquipeA` | texto |
| `nomeEquipeB` | texto |
| `dataPrevista` | data/hora ISO-8601 |
| `destinatarios` | IDs dos usuários que devem receber aviso (pode vir vazia) |

## Dead letter

Cada serviço expõe, para o administrador:

- `GET /api/<servico>/dlq` — lista as mensagens paradas, sem consumi-las.
- `POST /api/<servico>/dlq/reprocessar` — devolve as mensagens ao exchange para nova tentativa.

Falhas transitórias (banco indisponível, por exemplo) são repetidas três vezes antes de ir
para a dead letter. Falhas permanentes — contrato violado, como um empate chegando a um
torneio de eliminação simples — vão direto, sem gastar retentativas.
