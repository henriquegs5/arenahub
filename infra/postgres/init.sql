-- Um banco e um usuário por serviço. Nenhum usuário acessa o banco de outro.
CREATE USER identidade_user    WITH PASSWORD 'identidade_pw';
CREATE USER equipes_user       WITH PASSWORD 'equipes_pw';
CREATE USER torneios_user      WITH PASSWORD 'torneios_pw';
CREATE USER partidas_user      WITH PASSWORD 'partidas_pw';
CREATE USER ranking_user       WITH PASSWORD 'ranking_pw';
CREATE USER notificacoes_user  WITH PASSWORD 'notificacoes_pw';

CREATE DATABASE identidade_db   OWNER identidade_user;
CREATE DATABASE equipes_db      OWNER equipes_user;
CREATE DATABASE torneios_db     OWNER torneios_user;
CREATE DATABASE partidas_db     OWNER partidas_user;
CREATE DATABASE ranking_db      OWNER ranking_user;
CREATE DATABASE notificacoes_db OWNER notificacoes_user;

REVOKE CONNECT ON DATABASE identidade_db, equipes_db, torneios_db, partidas_db, ranking_db, notificacoes_db FROM PUBLIC;
GRANT CONNECT ON DATABASE identidade_db   TO identidade_user;
GRANT CONNECT ON DATABASE equipes_db      TO equipes_user;
GRANT CONNECT ON DATABASE torneios_db     TO torneios_user;
GRANT CONNECT ON DATABASE partidas_db     TO partidas_user;
GRANT CONNECT ON DATABASE ranking_db      TO ranking_user;
GRANT CONNECT ON DATABASE notificacoes_db TO notificacoes_user;
