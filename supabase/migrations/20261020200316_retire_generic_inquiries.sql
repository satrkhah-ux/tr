begin;
-- Retired inputs are accepted only as the one explicit unclear category.
create or replace function public.protect_manual_lead_inquiry()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.inquiry_source = 'manual'
    and old.inquiry in ('بكج','فنادق','طيران','تأشيرات','مواصلات')
    and new.inquiry_source in ('auto','murad') then
    new.inquiry := old.inquiry;
    new.inquiry_source := old.inquiry_source;
  end if;
  if new.inquiry is not null and new.inquiry not in ('بكج','فنادق','طيران','تأشيرات','مواصلات','طلب غير واضح') then
    new.inquiry := 'طلب غير واضح';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_manual_lead_inquiry on public.client_leads;
create trigger protect_manual_lead_inquiry before insert or update of inquiry,inquiry_source
on public.client_leads for each row execute function public.protect_manual_lead_inquiry();
revoke all on function public.protect_manual_lead_inquiry() from public,anon,authenticated;
create or replace function public.client_leads_screen_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  dest text := btrim(coalesce(new.destination, ''));
begin
  if dest = '' or new.inquiry is null or new.inquiry not in ('بكج', 'فنادق', 'طيران', 'تأشيرات') then return new; end if;
  if coalesce(new.last_visit_at, new.created_at) < now() - interval '6 hours' then return new; end if;
  if tg_op = 'UPDATE'
    and new.destination is not distinct from old.destination
    and new.inquiry is not distinct from old.inquiry
    and new.last_visit_at is not distinct from old.last_visit_at then return new; end if;
  perform pg_advisory_xact_lock(hashtext('office_screen_events'));
  insert into public.office_screen_events(lead_id, kind, destination, at)
  values(new.id, new.inquiry, dest, public.office_screen_next_at())
  on conflict (lead_id, destination, request_day) do nothing;
  delete from public.office_screen_events where at < now() - interval '3 days';
  return new;
exception when others then
  raise warning 'office screen event failed: %', SQLSTATE;
  return new;
end;
$$;

update public.client_leads set inquiry = 'طلب غير واضح', inquiry_source = null
where inquiry is not null and inquiry not in ('بكج','فنادق','طيران','تأشيرات','مواصلات','طلب غير واضح');
delete from public.office_screen_events where kind not in ('بكج','فنادق','طيران','تأشيرات');
update public.app_settings
set value = jsonb_set(value::jsonb, '{kinds}', coalesce((select jsonb_agg(k) from jsonb_array_elements_text(value::jsonb->'kinds') k where k in ('بكج','فنادق','طيران','تأشيرات')), '[]'::jsonb))::text
where key = 'office_screens' and jsonb_typeof(value::jsonb->'kinds') = 'array';
commit;
