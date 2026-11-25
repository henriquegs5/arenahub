# CEFET/RJ — Arquitetura e Padrões de Software (2026.1)
## 2ª Avaliação da Disciplina (Peso: 60%)

* **Tema:** Microsserviços
* **Equipe:** Grupo 5 — ArenaHub
* **Professor Avaliador:** Prof. Dr. Marcelo Rodrigues Arêas

### Integrantes do Grupo:
1. **Pedro Henrique Maia da Silva**
2. **Gabriel Coelho**
3. **André Veiga**
4. **Henrique Guimarães**
5. **Victor Furrer**

---

## Mapeamento Formal dos Entregáveis Solicitados

Em estrito atendimento às instruções da atividade, este arquivo compactado contém todos os itens exigidos organizados conforme a tabela abaixo:

| Item Solicitado no Enunciado | Arquivo / Diretório no Pacote | Descrição e Observações |
|---|---|---|
| **1. Código fonte completo do projeto desenvolvido** | Raiz do projeto (`services/`, `gateway/`, `frontend/`, `contracts/`, `infra/`, `docker-compose.yml`) | Backend integralmente desenvolvido em **Python 3.12 (FastAPI)** com mensageria assíncrona **RabbitMQ**, persistência isolada **PostgreSQL 16** e interface **React (Vite)**. |
| **2. Documento PDF: Padrões de Software utilizados e porquê** | `1-DOCUMENTACAO-ARQUITETURAL/01-padroes-de-software.pdf`<br>(e `docs/entrega/pdfs/01-padroes-de-software.pdf`) | Documento acadêmico de 20 páginas contendo a fundamentação, intenção, diagrama de classes e código real dos **11 padrões GoF** e **5 padrões arquiteturais** aplicados no ecossistema. |
| **3. Documento PDF: Descrição do Sistema, Preocupações (Concerns), Pontos de Vista e Perspectivas** | `1-DOCUMENTACAO-ARQUITETURAL/02-descricao-do-sistema.pdf`<br>(e `docs/entrega/pdfs/02-descricao-do-sistema.pdf`) | Documento acadêmico de 12 páginas baseado nas normas **ISO/IEC 42010**, **ISO/IEC 25010** e no framework de **Rozanski & Woods**. Contempla problema/solução, 9 stakeholders, matriz de qualidade, 6 viewpoints, 4 perspectivas e registro de testes práticos de tolerância a falhas. |
| **4. Diagrama de Implantação (Módulos do Sistema)** | `1-DOCUMENTACAO-ARQUITETURAL/diagramas/implantacao.png`<br>`1-DOCUMENTACAO-ARQUITETURAL/diagramas/implantacao.puml` | Ilustra a topologia física e virtualizada dos contêineres Docker, mapeamento de portas, redes virtuais bridge, brokers de mensageria e isolamento de bancos relacionais (*Database-per-Service*). |
| **5. Diagramas de Casos de Uso (Funcionalidades por tipo de ator)** | `1-DOCUMENTACAO-ARQUITETURAL/diagramas/casos-de-uso.png`<br>`1-DOCUMENTACAO-ARQUITETURAL/diagramas/casos-de-uso.puml` | Mapeia os 3 tipos de atores do sistema (`ADM`, `ORGANIZADOR` e `PARTICIPANTE`) com todas as suas permissões e casos de uso de gestão, compra, validação de portaria e operação. |
| **6. Diagramas de Atividades (Detalhes de funcionalidades e interações)** | `1-DOCUMENTACAO-ARQUITETURAL/diagramas/atividades-compra-saga.png` (`.puml`)<br>`1-DOCUMENTACAO-ARQUITETURAL/diagramas/atividades-checkin.png` (`.puml`) | **Saga da Compra**: detalha a coreografia assíncrona entre Ingressos, Eventos, Pagamento e Notificações, com fluxos felizes e de compensação atômica.<br>**Validação no Portão**: detalha o check-in atômico de QR Code com prevenção de dupla entrada. |
| **7. Diagramas de Estados (Máquinas de Estado do Sistema)** | `1-DOCUMENTACAO-ARQUITETURAL/diagramas/estados-pedido.png` (`.puml`)<br>`1-DOCUMENTACAO-ARQUITETURAL/diagramas/estados-evento.png` (`.puml`)<br>`1-DOCUMENTACAO-ARQUITETURAL/diagramas/estados-disjuntor.png` (`.puml`) | **Ciclo do Pedido e Ingresso**: `PENDENTE`, `RESERVADO`, `AGUARDANDO_PAGAMENTO`, `PAGO`, `CONCLUIDO`, `RECUSADO`, `EXPIRADO`, `CANCELADO` e estados do ingresso.<br>**Ciclo do Evento**: `RASCUNHO`, `PUBLICADO`, `VENDAS_ABERTAS`, `VENDAS_ENCERRADAS`, `REALIZADO`, `CANCELADO`..<br>**Ciclo do Circuit Breaker**: `FECHADO`, `ABERTO`, `MEIO_ABERTO`.. |
| **8. Diagrama de Classes Geral (Padrões GoF)** | `1-DOCUMENTACAO-ARQUITETURAL/diagramas/padroes-gof.png`<br>`1-DOCUMENTACAO-ARQUITETURAL/diagramas/padroes-gof.puml` | Diagrama consolidado de classes demonstrando a implementação de Composite, State, Strategy, Factory Method, Command, Chain of Responsibility, Observer e Adapter. |

---

## Instruções Rápidas para Execução do Sistema

Requisito: Docker e Docker Compose instalados.

```bash
# 1. Subir todos os microsserviços, banco, broker e interface:
docker compose up --build -d

# 2. Acessar os ambientes:
# Frontend React: http://localhost:3000
# API Gateway / Health: http://localhost:8080/health
# Painel RabbitMQ: http://localhost:15672 (login: guest / senha: guest)

# 3. Credenciais administrativas padrão (criadas automaticamente):
# E-mail: admin@arenahub.local
# Senha:  arenahub123

# 4. Executar os testes automatizados:
# Testes de Contratos JSON Schema:
python3 scripts/check-contratos.py

# Testes Unitários de Domínio (em container):
docker compose exec eventos python -m unittest discover -s . -p "*test*.py"

# Bateria Completa de Integração e Resiliência (E2E):
python3 scratch/test_guia.py
```
