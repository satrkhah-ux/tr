-- 0083 — the administration's two dated client messages (2026-10-17):
--   trip_reminder: ONE message two days before the travel day — passport and
--     tickets, the documents and the driver, «سفراً ممتعاً», and the rating
--     after the return — instead of four separate ones;
--   welcome: the morning after the travel day (unchanged, already on).
-- The four it replaces (three days before, the day before, the travel day,
-- the rating after the return) and the mid-trip check-in are switched OFF,
-- not deleted: a manager can switch any back on from /settings/client-comms.

alter table public.client_message_templates drop constraint if exists client_message_templates_key_check;
alter table public.client_message_templates add constraint client_message_templates_key_check
  check (key in ('bookings_confirmed', 'documents_ready', 'trip_reminder', 'three_days_before', 'day_before', 'departure_day', 'welcome', 'midway', 'rate_trip'));

insert into public.client_message_templates (key, body, enabled) values
  ('trip_reminder',
   E'عميلنا {name}،\n\nنذكّرك بموعد رحلتك إلى {destination} يوم {date}\n\n(رقم الملف {serial})\n\nتأكد من جواز السفر والتذاكر، وتجد مستندات رحلتك وبيانات الاستقبال والسائق من هنا:\n\n{link}\n\nنتمنى لك سفراً ممتعاً وآمناً، وبعد عودتك يسعدنا تقييمك لرحلتك من الرابط نفسه\n\nفريق ترافليون للسفر والسياحة',
   true)
on conflict (key) do nothing;

update public.client_message_templates
   set enabled = false, updated_at = now()
 where key in ('three_days_before', 'day_before', 'departure_day', 'midway', 'rate_trip');

update public.client_message_templates set enabled = true, updated_at = now() where key = 'welcome';

notify pgrst, 'reload schema';
