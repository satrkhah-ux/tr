-- «الدفعات» (operations order 7): the receipt voucher, the client's proof of
-- payment, and the installment schedule.
--
--  · operation_payments.receipt_no / receipt_token — «سند القبض». The number is
--    what the client quotes back to us; the token is the ONLY gate of its PDF
--    (/trip/receipt/<token>/pdf) — the /voucher pattern: RLS cannot see a URL,
--    so the route checks the token through the service role. Null on refunds
--    and on payments recorded before this migration; those get one the first
--    time staff open their receipt.
--  · operation_payments.proof_path — the transfer slip / POS receipt the client
--    sent, in the PRIVATE `payment-proofs` bucket. A path, never a URL.
--  · operation_payments.updated_at — payments are now editable.
--  · operation_installments — what is due when. NO rows means the default
--    schedule (50% at confirmation, the rest 14 days before travel), derived in
--    code (src/lib/operations/payments.ts) so every existing case has one
--    without a backfill.
--
-- Additive only; idempotent, safe to re-run. Apply BEFORE deploying the code
-- that reads these columns — the old code never selects them.

alter table public.operation_payments
  add column if not exists receipt_no text,
  add column if not exists receipt_token text,
  add column if not exists proof_path text,
  add column if not exists updated_at timestamptz;

-- unique but nullable: a refund has no receipt, an old row has none yet
create unique index if not exists operation_payments_receipt_no_key
  on public.operation_payments (receipt_no);
create unique index if not exists operation_payments_receipt_token_key
  on public.operation_payments (receipt_token);

create table if not exists public.operation_installments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  due_date date not null,
  -- in the offer's currency, like the total it splits
  amount numeric(12, 2) not null check (amount > 0),
  note text,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists operation_installments_operation_id_idx
  on public.operation_installments (operation_id, due_date);

-- Staff only. No partner policy: a partner reads its own operations and
-- payments (0037), and this order does not widen that.
alter table public.operation_installments enable row level security;
drop policy if exists operation_installments_staff on public.operation_installments;
create policy operation_installments_staff on public.operation_installments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- PRIVATE, and no storage policy — the passports / partner-documents posture.
-- A policy could only test bucket_id, which would hand every signed-in user
-- every client's bank slip; the service role writes, and signs a 5-minute URL
-- behind operations.write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  8388608,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
