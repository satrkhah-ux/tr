-- OPTIONAL — apply only on the owner's word (session B asked: who holds the status buttons by default?).
-- Gives «لدي عميل» / «لدي اتصال» / «صلاة» to every role that sells (offers.write). Without it, the
-- administration grants them role by role on «الأقسام والصلاحيات». Idempotent: a key already held is not added twice.

update public.roles r
set permission_keys = (
  select array_agg(distinct k)
  from unnest(coalesce(r.permission_keys, '{}'::text[]) || array['status.client', 'status.call', 'status.prayer']) as k
)
where 'offers.write' = any (coalesce(r.permission_keys, '{}'::text[]));
