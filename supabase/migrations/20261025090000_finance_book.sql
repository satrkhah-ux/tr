-- «الحسابات المالية» (the owner, 2026-10-25: «النظام المالي الذي صممناه امس انشره»): salaries, rents,
-- debts, bookings and the partners' split as ONE document. Every save appends a version, so the latest
-- row is the book and the earlier ones are its history (restore = save an old version again).
--
-- Closed to sessions (RLS on, no policy): only the server, after developer.access, reads or writes it.
create table if not exists public.finance_book_versions (
  id bigserial primary key,
  book jsonb not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users (id) on delete set null
);

alter table public.finance_book_versions enable row level security;
revoke all on public.finance_book_versions from anon, authenticated;
