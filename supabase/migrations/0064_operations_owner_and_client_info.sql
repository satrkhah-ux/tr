-- App Travluin — operations orders 9 & 10: who owns a case, and what the client's
-- trip page says about reaching us.
--
--   assignee_id  the employee answerable for the whole case («مسؤول الحالة»). A
--                column, not an audit row: the list filters on it on every render.
--   client_info  {emergency_phone, agent_name, agent_phone, pay_note} — typed by
--                ops, shown on /trip/[token]. Client-facing by definition, so it is
--                fine that a partner's own-file read (0037) can see it too.
--
-- Deliberately NOT here:
--   * internal notes — they are audit_logs rows (action 'operation.note'): RLS-locked
--     to the service role (0017), so neither a partner nor the client link can ever
--     read one, and they land in the case's activity log for free;
--   * driver details — they live in operation_bookings.detail (السائق، جوال السائق،
--     السيارة، رقم السيارة), like every other booking fact.
--
-- No new table, so no new policy: operations keeps its staff policy (is_staff(),
-- 0034) and the partner read of 0037. Additive and idempotent; safe to re-run.

alter table public.operations
  add column if not exists assignee_id uuid references public.employees (id) on delete set null;

alter table public.operations
  add column if not exists client_info jsonb not null default '{}'::jsonb;

create index if not exists operations_assignee_id_idx on public.operations (assignee_id);

-- the case's activity log reads audit_logs by entity_id; until now only created_at was indexed
create index if not exists audit_logs_entity_id_idx on public.audit_logs (entity_id, created_at desc);

notify pgrst, 'reload schema';
