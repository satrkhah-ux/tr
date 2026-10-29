-- «المفاتيح والتوكنات» (the owner, 2026-10-29): API keys and tokens added from
-- «المطوّر» without a redeploy. Each row is ONE named secret, encrypted with
-- the existing vault (src/lib/crypto/secrets.ts — AES-256-GCM under
-- SETTINGS_ENCRYPTION_KEY); the server reads it through getSecret(name), which
-- falls back to the server's environment when the vault has none.
--
-- The value never leaves the server: the page shows only whether it is set,
-- where from, its last four characters, and who changed it when.
-- Closed table: RLS on with no policies + default grants revoked — only the
-- service role behind the developer.access server actions reaches it.
-- NOT applied by the session: the coordinator applies it after a backup.
-- Dry run: begin; \i this file; rollback;   Rollback: scripts/rollback-app-secrets.sql
create table if not exists public.app_secrets (
  -- the environment variable's own name («MYFATOORAH_API_KEY»)
  name text primary key check (name ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  value_enc text not null check (char_length(value_enc) <= 12000),
  -- the last four characters, to tell two keys apart — never more
  last4 text check (char_length(last4) <= 4),
  updated_by uuid references public.employees(id) on delete set null,
  updated_by_label text check (char_length(updated_by_label) <= 200),
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
