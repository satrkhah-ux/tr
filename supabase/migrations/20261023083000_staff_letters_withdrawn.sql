-- «الخطاب الرسمي» رقم 2 — the withdrawal it announces (the owner, 2026-10-23: «اسحب آلياً
-- المحادثات المفتوحة التي مرّ عليها ٣ أيام بلا رد من العميل، وأعدها لقسم المبيعات بلا
-- موظف. لا تسحب محادثة فيها عميل ينتظر الرد»).
--
-- withdrawn_at is claimed once, right after the warned letter reached the employee;
-- withdrawn lists the Teletel conversations that went back to «قسم المبيعات».

alter table public.staff_letters add column if not exists withdrawn_at timestamptz;
alter table public.staff_letters add column if not exists withdrawn jsonb;
