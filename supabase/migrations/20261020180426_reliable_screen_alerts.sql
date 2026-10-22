-- One announcement per conversation/destination/Riyadh day. A returning client
-- can be announced again; background saves and service refinement don't repeat.
alter table public.office_screen_events add column if not exists request_day date;
update public.office_screen_events
set request_day = (created_at at time zone 'Asia/Riyadh')::date where request_day is null;
alter table public.office_screen_events alter column request_day
  set default ((now() at time zone 'Asia/Riyadh')::date);
alter table public.office_screen_events alter column request_day set not null;
drop index if exists public.office_screen_events_once;
create unique index office_screen_events_once on public.office_screen_events(lead_id, destination, request_day);

create or replace function public.office_screen_next_at() returns timestamptz
language sql security definer set search_path = public as $$
  select greatest(now(), coalesce((select max(at) from public.office_screen_events), now()) + interval '22 seconds');
$$;

create or replace function public.client_leads_screen_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  dest text := btrim(coalesce(new.destination, ''));
begin
  if dest = '' or new.inquiry is null or new.inquiry not in ('بكج', 'فنادق', 'طيران', 'تأشيرات', 'يستفسر') then return new; end if;
  if coalesce(new.last_visit_at, new.created_at) < now() - interval '6 hours' then return new; end if;
  if tg_op = 'UPDATE'
    and new.destination is not distinct from old.destination
    and new.inquiry is not distinct from old.inquiry
    and new.last_visit_at is not distinct from old.last_visit_at then return new; end if;
  perform pg_advisory_xact_lock(hashtext('office_screen_events'));
  insert into public.office_screen_events(lead_id, kind, destination, at)
  values(new.id, new.inquiry, dest, public.office_screen_next_at())
  on conflict (lead_id, destination, request_day) do update
    set kind = excluded.kind
    -- Refine an unclassified inquiry before its scheduled presentation, keeping
    -- its identity and position in the queue. Never replace a known service.
    where office_screen_events.kind = 'يستفسر'
      and excluded.kind <> 'يستفسر'
      and office_screen_events.at + interval '8 seconds' > now();
  delete from public.office_screen_events where at < now() - interval '3 days';
  return new;
exception when others then
  raise warning 'office screen event failed: %', SQLSTATE;
  return new;
end;
$$;
drop trigger if exists client_leads_screen_event on public.client_leads;
create trigger client_leads_screen_event
after insert or update of inquiry, destination, last_visit_at on public.client_leads
for each row execute function public.client_leads_screen_event();
revoke all on function public.office_screen_next_at() from public, anon, authenticated;
revoke all on function public.client_leads_screen_event() from public, anon, authenticated;
grant execute on function public.office_screen_next_at() to service_role;

-- Enable destination inquiries alongside the existing selected services.
-- Keep an explicitly disabled (empty) selection disabled.
update public.app_settings
set value = jsonb_set(value::jsonb, '{kinds}', (value::jsonb -> 'kinds') || '["يستفسر"]'::jsonb)::text
where key = 'office_screens'
  and jsonb_typeof(value::jsonb -> 'kinds') = 'array'
  and jsonb_array_length(value::jsonb -> 'kinds') > 0
  and not (value::jsonb -> 'kinds') @> '["يستفسر"]'::jsonb;
