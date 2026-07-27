-- Legacy import, step 1: CUSTOMERS.
--
-- Sources, in priority order:
--   legacy_app.customers   — the newer system; its columns are already almost
--                            exactly ours, so it wins on any conflict.
--   legacy_sys.app_clients — the older system; a row is added only when that
--                            person is not already here (matched on normalised
--                            mobile), so someone present in BOTH old systems
--                            becomes ONE customer, not two.
--
-- The uuid is generated in the CTE rather than left to the column default, so
-- each new row is paired to its legacy id exactly — no relying on insert order.
--
-- Idempotent: every source row is skipped once public.legacy_id_map knows it.

begin;

-- ---------- 1. the newer system (authoritative) ----------
with fresh as (
  select
    c.id as legacy_id,
    gen_random_uuid() as new_id,
    btrim(c.arabic_name) as arabic_name,
    nullif(btrim(coalesce(c.english_name, '')), '') as english_name,
    nullif(btrim(coalesce(c.mobile, '')), '') as mobile,
    nullif(btrim(coalesce(c.mobile_2, '')), '') as second_mobile,
    nullif(btrim(coalesce(c.email, '')), '') as email,
    c.birth_date,
    nullif(btrim(coalesce(c.passport_number, '')), '') as passport_number,
    nullif(btrim(coalesce(c.passport_first_name, '')), '') as passport_first_name,
    nullif(btrim(coalesce(c.passport_last_name, '')), '') as passport_last_name,
    c.passport_issue_date,
    c.passport_expiry_date
  from legacy_app.customers c
  where coalesce(btrim(c.arabic_name), '') <> ''
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'customer' and m.source = 'app' and m.legacy_id = c.id
    )
),
ins as (
  insert into public.customers (
    id, arabic_name, english_name, mobile, second_mobile, email, birth_date,
    passport_number, passport_first_name, passport_last_name,
    passport_issue_date, passport_expiry_date
  )
  select
    new_id, arabic_name, english_name, mobile, second_mobile, email, birth_date,
    passport_number, passport_first_name, passport_last_name,
    passport_issue_date, passport_expiry_date
  from fresh
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'customer', 'app', legacy_id, new_id from fresh;

-- ---------- 2. the older system (only people we don't have yet) ----------
with existing_mobiles as (
  select distinct public.legacy_norm_mobile(mobile) as m
  from public.customers
  where public.legacy_norm_mobile(mobile) is not null
),
candidates as (
  -- one row per person: the old system can hold the same mobile twice, so keep
  -- the lowest ClientId and let the rest fall away with the dedupe below.
  select distinct on (public.legacy_norm_mobile(a.phonenumber), btrim(a.namearabic))
    a.clientid as legacy_id,
    btrim(a.namearabic) as arabic_name,
    nullif(btrim(coalesce(a.nameenglish, '')), '') as english_name,
    nullif(btrim(coalesce(a.phonenumber, '')), '') as mobile,
    nullif(btrim(coalesce(a.phonenumber2, '')), '') as second_mobile,
    nullif(btrim(coalesce(a.email, '')), '') as email
  from legacy_sys.app_clients a
  where coalesce(btrim(a.namearabic), '') <> ''
    and not exists (
      select 1 from public.legacy_id_map m
      where m.entity = 'customer' and m.source = 'sys' and m.legacy_id = a.clientid
    )
  order by public.legacy_norm_mobile(a.phonenumber), btrim(a.namearabic), a.clientid
),
fresh_sys as (
  select gen_random_uuid() as new_id, c.*
  from candidates c
  where public.legacy_norm_mobile(c.mobile) is null
     or public.legacy_norm_mobile(c.mobile) not in (select m from existing_mobiles)
),
ins_sys as (
  insert into public.customers (id, arabic_name, english_name, mobile, second_mobile, email)
  select new_id, arabic_name, english_name, mobile, second_mobile, email
  from fresh_sys
)
insert into public.legacy_id_map (entity, source, legacy_id, new_id)
select 'customer', 'sys', legacy_id, new_id from fresh_sys;

commit;
