-- «الحسابات المالية» password (the owner, 2026-10-24: «اجعل عند الدخول الى النظام المالي يطلب كلمة سر مرة
-- واحدة للجلسة الواحدة و انا اضعه اول الدخول»): one row, the scrypt hash the owner set on his first visit.
-- Forgotten password: delete the row and the next visit asks for a new one.
--
-- Closed to sessions (RLS on, no policy): only the server reads it.
create table if not exists public.finance_lock (
  id smallint primary key default 1 check (id = 1),
  hash text not null,
  set_at timestamptz not null default now(),
  set_by uuid references auth.users (id) on delete set null
);

alter table public.finance_lock enable row level security;
revoke all on public.finance_lock from anon, authenticated;
