begin;
alter table public.client_leads add column if not exists destination_source text
  check (destination_source in ('client', 'labels', 'manual'));
comment on column public.client_leads.destination_source is 'client = explicit client message; labels = provisional label; manual = staff selection; null = legacy/imported value preserved';
-- Confirmed case: employee wording «التفاصيل والبرنامج» falsely matched «يلوا».
update public.client_leads set destination = 'اندونيسيا', destination_source = 'client', updated_at = now()
where id = 'dd2b0f1f-806f-45b8-a181-8a956c6d11b8' and teletel_conversation_id = 40310 and destination = 'يلوا';
commit;
