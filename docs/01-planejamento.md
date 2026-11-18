# ArenaHub — Planejamento (Etapa 1)

## Serviços e dono dos dados
| Serviço | Responsabilidade | Dados exclusivos |
|---|---|---|
| Identidade | Cadastro, login, JWT, papel (jogador/organizador) | usuários |
| Equipes | Equipe, membros, capitão, elegibilidade | equipes, membros |
| Torneios | Torneio, regras, inscrições, confrontos, avanço da chave | torneios, inscrições |
| Partidas | Agenda, resultado, confirmação, contestação | partidas |
| Ranking | Classificação por torneio e ranking geral | tabelas de pontos |
| Notificações | Reage a eventos e registra avisos | notificações |
| Gateway | Entrada única, JWT, Circuit Breaker | — |

## Saga de inscrição (coreografada)
Torneios cria inscrição PENDENTE → `inscricao.solicitada` → Equipes valida → `equipe.validada` ou `equipe.rejeitada` → Torneios confirma, ou cancela e libera a vaga (compensação).

## Máquinas de estado
- Torneio: RASCUNHO → INSCRICOES_ABERTAS → EM_ANDAMENTO → FINALIZADO (CANCELADO antes de finalizar)
- Partida: AGENDADA → RESULTADO_INFORMADO → CONFIRMADA | CONTESTADA → CONFIRMADA
- Inscrição: PENDENTE → CONFIRMADA | REJEITADA

## Padrões GoF
| Padrão | Serviço | Uso |
|---|---|---|
| Strategy | Torneios, Ranking | Geração de confrontos por formato; desempate |
| Factory Method | Torneios | Escolhe a Strategy pelo formato |
| Composite | Torneios | Chave: rodada contém partidas |
| State | Torneios, Partidas | Ciclo de vida |
| Chain of Responsibility | Equipes | Validação de elegibilidade |
| Command | Partidas | Informar, confirmar, contestar resultado |
| Observer | Ranking, Notificações | Consumo de eventos |
| Adapter | Notificações | Canal de aviso atrás de interface |
| Facade / Proxy | Gateway | Entrada única, JWT, Circuit Breaker |

Arquiteturais: API Gateway, Database per Service, Saga, Pub/Sub, Circuit Breaker.

## Demo (15–20 min)
Cadastro/login → equipe → torneio + inscrição (Saga) → gerar confrontos → informar/confirmar/contestar → ranking e notificações → derrubar Ranking e mostrar o resto funcionando.
