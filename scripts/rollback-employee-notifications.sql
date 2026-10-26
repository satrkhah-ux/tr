-- Rollback of 20261026140000_employee_notifications.sql — the table and its
-- indexes only; nothing else references it. Run only on the owner's word,
-- after a backup (the notifications in it are lost for good).
drop table if exists public.employee_notifications;
