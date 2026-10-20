begin;
alter table public.client_leads add column if not exists inquiry_source text check (inquiry_source in ('manual','auto','sheet','murad'));
comment on column public.client_leads.inquiry_source is 'Classification origin. Null is legacy/unknown and must not be attributed to staff.';
-- Automatic jobs may finish after a staff edit; preserve the staff choice atomically.
create or replace function public.protect_manual_lead_inquiry() returns trigger language plpgsql set search_path = public as $$
begin
  if old.inquiry_source = 'manual' and new.inquiry_source in ('auto','murad') then
    new.inquiry := old.inquiry;
    new.inquiry_source := old.inquiry_source;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_manual_lead_inquiry on public.client_leads;
create trigger protect_manual_lead_inquiry before update of inquiry, inquiry_source on public.client_leads
for each row execute function public.protect_manual_lead_inquiry();
revoke all on function public.protect_manual_lead_inquiry() from public, anon, authenticated;
commit;
