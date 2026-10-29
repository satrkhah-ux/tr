-- Rollback of 20261029120100_app_secrets.sql. The keys saved in it are lost
-- (getSecret then falls back to the server's environment). Owner's word + backup first.
drop table if exists public.app_secrets;
