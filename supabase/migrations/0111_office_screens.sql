-- ============================================================================
-- 0111 — «الشاشات»: the office screens' live alert (the owner, 2026-10-19)
--
-- When a conversation is classified as a request with a destination, every
-- screen in the office shows the same overlay at the same moment —
-- «عميل جديد طلب تركيا الآن». One row here per conversation and destination,
-- written by a trigger on client_leads: five places write a lead's kind and
-- destination today (staff on «العملاء», the Teletel pull, the sheet sync,
-- Murad's reception …) and this is the one they all pass through.
--
--  · only a fresh conversation (its last visit, else its date, within 6 hours):
--    a bulk correction of old rows must not set the office flashing;
--  · only the kinds a screen may announce (بكج، فنادق، طيران، تأشيرات); which of
--    them actually alert is the settings page's choice, read by the screens;
--  · `at` is spread: never closer than 10 s to the previous event, so a burst
--    from one pull plays one after another instead of on top of each other;
--  · the destination is kept as written — the screen resolves it to a country
--    (lib/leads/places.ts) and drops an origin («الرياض») or nothing;
--  · NEVER a name or a phone: the lead's id only ties the row to its
--    conversation for the once-only rule; the screens get destination and kind.
--  · test = «جرّب الإشعار» from the settings page, shown marked «تجربة».
--
-- RLS on, no policy: only the server (service role) reads or writes. Rows older
-- than three days are dropped as new ones come. Idempotent.
-- ============================================================================

create table if not exists public.office_screen_events (
  id bigserial primary key,
  lead_id uuid references public.client_leads (id) on delete cascade,
  kind text not null,
  destination text not null,
  test boolean not null default false,
  at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists office_screen_events_once on public.office_screen_events (lead_id, destination);
create index if not exists office_screen_events_at on public.office_screen_events (at desc);

alter table public.office_screen_events enable row level security;

/** the next free moment: now, or ten seconds after the last event, whichever is later */
create or replace function public.office_screen_next_at() returns timestamptz
language sql
security definer
set search_path = public
as $$
  select greatest(now(), coalesce((select max(at) from public.office_screen_events), now()) + interval '10 seconds');
$$;

create or replace function public.client_leads_screen_event() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dest text := btrim(coalesce(new.destination, ''));
begin
  if dest = '' or new.inquiry is null or new.inquiry not in ('بكج', 'فنادق', 'طيران', 'تأشيرات') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.destination is not distinct from old.destination and new.inquiry is not distinct from old.inquiry then
    return new;
  end if;
  if coalesce(new.last_visit_at, new.created_at) < now() - interval '6 hours' then
    return new;
  end if;
  -- one writer at a time, so two leads in one pull cannot take the same moment
  perform pg_advisory_xact_lock(hashtext('office_screen_events'));
  insert into public.office_screen_events (lead_id, kind, destination, at)
  values (new.id, new.inquiry, dest, public.office_screen_next_at())
  on conflict (lead_id, destination) do nothing;
  delete from public.office_screen_events where at < now() - interval '3 days';
  return new;
exception when others then
  -- a screen must never stop a conversation from being saved
  return new;
end;
$$;

drop trigger if exists client_leads_screen_event on public.client_leads;
create trigger client_leads_screen_event
  after insert or update of inquiry, destination on public.client_leads
  for each row execute function public.client_leads_screen_event();

revoke all on function public.office_screen_next_at() from public, anon, authenticated;
revoke all on function public.client_leads_screen_event() from public, anon, authenticated;
