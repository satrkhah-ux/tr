-- Operations order 11 (suggestions 5 and 11): what a traveller needs to know
-- where they land, and the messages the client receives along the way.
--
--  · destination_guides — per country: our local agent and the numbers that
--    matter (embassy, ambulance, police, a hospital). Shown on the trip link.
--  · client_message_templates — the WhatsApp messages sent to the client at
--    each stage. Seeded DISABLED: nothing is sent until a manager reads,
--    edits and switches each one on.

create table if not exists public.destination_guides (
  country_id uuid primary key references public.countries (id) on delete cascade,
  local_agent_name text,
  local_agent_phone text,
  embassy_phone text,
  ambulance text,
  police text,
  hospital text,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.client_message_templates (
  key text primary key check (key in ('bookings_confirmed', 'documents_ready', 'day_before', 'welcome', 'rate_trip')),
  body text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.client_message_templates (key, body) values
  ('bookings_confirmed', 'مرحباً {name}، تأكدت حجوزات رحلتكم إلى {destination} ({serial}). تابعوا رحلتكم من هنا: {link}'),
  ('documents_ready', 'مرحباً {name}، مستندات رحلتكم إلى {destination} جاهزة: الفاوتشرات والتذاكر والبرنامج. {link}'),
  ('day_before', 'مرحباً {name}، رحلتكم إلى {destination} غداً. بطاقة الاستقبال والسائق في الرابط: {link} — رحلة سعيدة!'),
  ('welcome', 'حمداً لله على سلامتكم في {destination} يا {name}. نحن معكم طوال الرحلة: {link}'),
  ('rate_trip', 'نتمنى أن رحلتكم إلى {destination} كانت ممتعة يا {name}. شاركونا رأيكم بنقرة: {rate_link}')
on conflict (key) do nothing;

alter table public.destination_guides enable row level security;
alter table public.client_message_templates enable row level security;

drop policy if exists destination_guides_staff on public.destination_guides;
create policy destination_guides_staff on public.destination_guides
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists client_message_templates_staff on public.client_message_templates;
create policy client_message_templates_staff on public.client_message_templates
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

notify pgrst, 'reload schema';
