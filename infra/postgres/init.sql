-- DATABASE PER SERVICE: um banco e um usuário por serviço.
-- Nenhum usuário tem permissão no banco de outro, então um serviço não consegue
-- ler os dados de outro nem por engano. Não há join nem chave estrangeira
-- atravessando serviços: cada um guarda só o ID das entidades alheias.
--
-- O Gateway tem banco próprio porque absorveu a AUTENTICAÇÃO (contas e papéis).
-- Ele é infraestrutura, não um quinto microsserviço de domínio: o enunciado
-- exige exatamente quatro. Ver README.md, "Decisões de arquitetura".
--
-- ATENÇÃO: este script roda SOMENTE quando o volume do Postgres está vazio.
-- Ao trocar o conjunto de serviços, recrie o volume: docker compose down -v
CREATE USER gateway_user      WITH PASSWORD 'gateway_pw';
CREATE USER eventos_user      WITH PASSWORD 'eventos_pw';
CREATE USER ingressos_user    WITH PASSWORD 'ingressos_pw';
CREATE USER pagamento_user    WITH PASSWORD 'pagamento_pw';
CREATE USER notificacoes_user WITH PASSWORD 'notificacoes_pw';

CREATE DATABASE gateway_db      OWNER gateway_user;
CREATE DATABASE eventos_db      OWNER eventos_user;
CREATE DATABASE ingressos_db    OWNER ingressos_user;
CREATE DATABASE pagamento_db    OWNER pagamento_user;
CREATE DATABASE notificacoes_db OWNER notificacoes_user;

REVOKE CONNECT ON DATABASE gateway_db, eventos_db, ingressos_db, pagamento_db, notificacoes_db FROM PUBLIC;
GRANT CONNECT ON DATABASE gateway_db      TO gateway_user;
GRANT CONNECT ON DATABASE eventos_db      TO eventos_user;
GRANT CONNECT ON DATABASE ingressos_db    TO ingressos_user;
GRANT CONNECT ON DATABASE pagamento_db    TO pagamento_user;
GRANT CONNECT ON DATABASE notificacoes_db TO notificacoes_user;
