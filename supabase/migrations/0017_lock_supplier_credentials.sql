-- App Travluin — lock the supplier credential vault + audit log to the SERVICE ROLE.
-- The previous 0015 policy (`for all to authenticated`) let ANY signed-in employee
-- read the credential ciphertext / base_url and even overwrite/delete credentials via
-- direct PostgREST, bypassing the admin-gated server actions. Fix: drop the permissive
-- policy so RLS (still enabled) denies anon + authenticated entirely; the service-role
-- client (RLS-bypassing, server-only, admin-gated in app code) is the ONLY access path.
-- hotel_content_cache stays authenticated-readable (no secrets). Idempotent.

do $$ begin
  execute 'drop policy if exists authenticated_all on public.hotel_suppliers';
  execute 'drop policy if exists authenticated_all on public.audit_logs';
  -- RLS remains ENABLED with no permissive policy → anon/authenticated get nothing.
  execute 'alter table public.hotel_suppliers enable row level security';
  execute 'alter table public.audit_logs enable row level security';
end $$;
