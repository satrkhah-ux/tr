-- «الحسابات» (2026-10-30): the new finance.accounts key receives the reminders to pay suppliers, refund
-- deadlines and clients' installments (lib/operations/daily.ts ACCOUNTS_PERMISSION), and opens /accounts.
-- Until today those reminders went to commissions.approve, so every role holding it gets the new key too —
-- nobody stops receiving them before the owner assigns the accounts staff on «الأقسام والصلاحيات».
-- Data only, idempotent: a key already held is not added twice.

update public.roles r
set permission_keys = (
  select array_agg(distinct k)
  from unnest(coalesce(r.permission_keys, '{}'::text[]) || array['finance.accounts']) as k
)
where 'commissions.approve' = any (coalesce(r.permission_keys, '{}'::text[]));
