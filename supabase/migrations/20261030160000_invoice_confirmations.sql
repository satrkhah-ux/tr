-- «الحسابات» stage 2 (the owner, 2026-10-30: «الفاتورة داخلية»): an internal invoice is a confirmed case read as
-- one (lib/accounts/invoice.ts) — nothing stored but the accounts team's «تأكيد الفاتورة»: who checked it and when.
-- One row per case. Closed to sessions (RLS on, no policy): only the server, after finance.accounts, reads or writes it.
create table if not exists public.invoice_confirmations (
  operation_id uuid primary key references public.operations (id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid references public.employees (id) on delete set null
);

alter table public.invoice_confirmations enable row level security;
revoke all on public.invoice_confirmations from anon, authenticated;
