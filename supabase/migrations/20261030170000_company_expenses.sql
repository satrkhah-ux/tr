-- «الحسابات» stage 3 (2026-10-30): «المصروفات» — what the company spends outside the trips: ads, bills,
-- government fees, bank and payment fees, office costs. Salaries and rents stay in «الحسابات المالية»
-- (the owner's book). The accounts team records them; the home subtracts the month's from its profit.
-- Closed to sessions (RLS on, no policy): only the server, after finance.accounts, reads or writes it.
create table if not exists public.company_expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null,
  category text not null check (category in ('ads', 'bills', 'government', 'bank', 'office', 'other')),
  title text not null check (char_length(title) between 1 and 200),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'SAR',
  method text not null check (method in ('bank_transfer', 'cash', 'card', 'other')),
  note text,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists company_expenses_spent_on_idx on public.company_expenses (spent_on desc);

alter table public.company_expenses enable row level security;
revoke all on public.company_expenses from anon, authenticated;
