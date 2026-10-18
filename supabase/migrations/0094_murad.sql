-- «مُراد» (the owner, 2026-10-18): «عندما لا يوجد استلام للطلبات خلال 5 دقيقة
-- هو يتدخل». Every minute /api/murad/run looks at the open Teletel
-- conversations; a client whose latest message has had no human reply for five
-- minutes gets ONE answer from Murad per client turn — a private suggestion note
-- for staff, or, for the numbers on the auto list only, a reply to the client
-- (src/lib/murad/*).
--
-- murad_log is both the dedupe and the trail:
--   · (conversation_id, client_message_id) is unique — the run claims the turn
--     by inserting its row BEFORE calling the model, so two overlapping runs
--     can never answer the same client message twice, and a crash after the
--     claim leaves the turn answered-at-most-once rather than twice;
--   · rows with a provider are the model calls the daily cap counts
--     (app_settings murad_daily_cap, default 300);
--   · staff_replied_at is filled by a later run when a human answered after
--     Murad — the quality metric on /developer.
--
-- RLS on: the job writes with the service role; staff may read (is_staff()).
-- Idempotent. NOT applied by the session that wrote it.

create table if not exists public.murad_log (
  id uuid primary key default gen_random_uuid(),
  conversation_id int not null,
  -- the client's latest message this answer is for (Teletel message id)
  client_message_id bigint not null,
  client_message_at timestamptz,
  phone text,
  -- auto: replied to the client · suggest: a private note for staff ·
  -- skipped: the turn was claimed and nothing was posted (see reason / error)
  mode text not null check (mode in ('auto', 'suggest', 'skipped')),
  -- 'claude' | 'openai'; null when no model was called
  provider text,
  model text,
  reply text,
  needs_staff boolean,
  reason text,
  -- what the client said so far (destination, dates, adults, children)
  intake jsonb,
  error text,
  -- Murad's own public reply in Teletel: never counted as a human answer
  reply_message_id bigint,
  -- when Murad finished writing to Teletel; later activity is news
  acted_at timestamptz,
  staff_replied_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists murad_log_turn on public.murad_log (conversation_id, client_message_id);
create index if not exists murad_log_recent on public.murad_log (created_at desc);

alter table public.murad_log enable row level security;

drop policy if exists murad_log_staff_read on public.murad_log;
create policy murad_log_staff_read
  on public.murad_log for select to authenticated
  using (public.is_staff());

notify pgrst, 'reload schema';

-- ROLLBACK (manual):
-- drop table if exists public.murad_log;
-- delete from public.app_settings where key in ('murad_auto_phones', 'murad_policies', 'murad_daily_cap', 'murad_run_lock', 'cron_last_run:murad_run');
-- notify pgrst, 'reload schema';
-- ============================================================================
