-- 0082 — the client's dated WhatsApp messages, beside the five from 0066:
-- three days before the trip, the travel day itself, and mid-trip. The welcome
-- now goes the morning AFTER the travel day (the morning job runs once a day,
-- and by then the group has landed). Each key also has a Meta-approved template
-- for after WhatsApp's 24 hours — WA_TEMPLATES in src/lib/operations/client-messages.ts.
--
-- Switched on: the owner asked for exactly these (2026-10-17). The trial gate
-- (app_settings.client_whatsapp) still decides whose clients hear them.

alter table public.client_message_templates drop constraint if exists client_message_templates_key_check;
alter table public.client_message_templates add constraint client_message_templates_key_check
  check (key in ('bookings_confirmed', 'documents_ready', 'three_days_before', 'day_before', 'departure_day', 'welcome', 'midway', 'rate_trip'));

insert into public.client_message_templates (key, body, enabled) values
  ('three_days_before',
   E'مرحباً {name} 👋\n\n⏳ باقي *3 أيام* على رحلتك إلى *{destination}*.\nتأكد من جواز السفر والتذاكر — كل مستندات رحلتك هنا:\n{link}\n\nفريق ترافليون للسفر والسياحة',
   true),
  ('departure_day',
   E'مرحباً {name} 👋\n\nاليوم موعد رحلتك إلى *{destination}* ✈️\nنتمنى لك سفراً ممتعاً وآمناً، ونحن معك خطوة بخطوة:\n{link}\n\nفريق ترافليون للسفر والسياحة',
   true),
  ('midway',
   E'مرحباً {name} 👋\n\nنطمئن عليك في *{destination}* 😊 نتمنى أن رحلتك تسير كما تحب.\nإن احتجت أي شيء نحن هنا، وبرنامجك على الرابط:\n{link}\n\nفريق ترافليون للسفر والسياحة',
   true)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
