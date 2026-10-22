-- ============================================================================
-- Sign a login out of every device (the owner, 2026-10-22: «حل مشكلة إصدار كلمة
-- سر جديدة للموظف من داخل لوحة الإدارة»).
--
-- An administrator may now give any staff or partner login a new temporary
-- password (lib/auth/temp-password.ts). Nobody may stay signed in on the old
-- one: this deletes the user's sessions, and their refresh tokens go with them
-- (auth.refresh_tokens → auth.sessions is ON DELETE CASCADE). An access token
-- still in a browser then fails getUser with session_not_found, and the app
-- drops it (lib/supabase/server.ts sessionGone).
--
-- The service role only — the server action calls it after its own gate.
-- Idempotent.
-- ============================================================================

create or replace function public.revoke_user_sessions(target uuid) returns integer
language sql
security definer
set search_path = auth, public
as $$
  with gone as (delete from auth.sessions where user_id = target returning 1)
  select count(*)::int from gone;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
