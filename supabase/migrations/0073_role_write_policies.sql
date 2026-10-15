-- ============================================================================
-- 0073 — the database checks the ROLE, not only "is this staff?"
--
-- Root cause A of the 2026-10-13 authorization audit. The money and execution
-- tables were `FOR ALL … using (is_staff())`, and signed-in users hold table
-- write grants on them, so any employee — Visa, Operation, sales — could skip
-- the app's requireOps / requireManage / currentCan gates by calling PostgREST
-- with their own token: insert client payments, mark bookings confirmed, forge
-- voucher tokens, rewrite ready-offer prices, wipe a partner's debt, overwrite
-- the house room cost, set their own arrival time.
--
--  · public.staff_can(p) — the app's currentCan() in SQL (roles.ts
--    grantedPermissions): an ACTIVE employee whose role's permission_keys holds
--    p. No implicit administrator: «All Permissions» is a role that lists every
--    key. Pinned by src/lib/roles/staff-can.test.ts.
--  · operations + every operation_* table with a staff policy + supplier_payments:
--    read on is_staff(), write on staff_can('operations.write').
--    operation_travelers / operation_passport_submissions have no policy at all
--    (service role only) and stay that way. Partner read policies are untouched.
--  · hotel_rate_memory: read is_staff(); insert/update offers.write; delete
--    settings.manage (the merge tool is SECURITY DEFINER, unaffected).
--  · ready_offers, partner_invoices, partner_payments: SELECT only for sessions;
--    every write is the service role behind the app's gate.
--  · attendance_days: written only by touch_attendance(), which keeps the
--    arrival (first_seen_at) and cannot be told a time (audit M4).
--  · offers: sessions lose UPDATE of partner_company_id, partner_cost, total,
--    total_sar and customer_id. The live grant is TABLE-level, which makes a
--    column revoke a no-op, so table UPDATE is revoked and the other columns are
--    granted back by name. (buy_total is not an offers column — it lives on
--    pricings, closed since 0039/0047.) A column added to offers later is NOT
--    session-updatable until granted here.
--  · storage `brands`: written by staff holding data.write — the gate of
--    uploadPartnerLogo, the only writer (a session upload) — instead of any
--    staff. Its types and size are 0074's (raster logos, 2 MB).
--
-- Deploy order: the app code that routes these writes through the service role
-- ships FIRST; then this migration. Idempotent.
-- ============================================================================

-- ---------- the helper ----------
create or replace function public.staff_can(p text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.employees e
      join public.roles r on r.id = e.role_id
     where e.auth_user_id = auth.uid()
       and e.status = 'Active'
       and p = any (r.permission_keys)
  );
$$;
comment on function public.staff_can(text) is
  'currentCan() in SQL: the signed-in user is an Active employee whose role grants permission p. Used by write policies (0073).';
revoke all on function public.staff_can(text) from public, anon;
grant execute on function public.staff_can(text) to authenticated, service_role;

-- ---------- operations: read is staff, write is operations.write ----------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('operations',             'operations_authenticated_all'),
      ('operation_payments',     'operation_payments_authenticated_all'),
      ('operation_bookings',     'operation_bookings_authenticated_all'),
      ('operation_dispatches',   'operation_dispatches_authenticated_all'),
      ('operation_documents',    'operation_documents_authenticated_all'),
      ('operation_installments', 'operation_installments_staff'),
      ('operation_alerts',       'operation_alerts_staff'),
      ('operation_issues',       'operation_issues_staff'),
      ('operation_ratings',      'operation_ratings_staff'),
      ('operation_links',        'operation_links_staff'),
      ('supplier_payments',      'supplier_payments_staff')
    ) as v(tbl, old_policy)
  loop
    execute format('drop policy if exists %I on public.%I', t.old_policy, t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_staff_read', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_ops_insert', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_ops_update', t.tbl);
    execute format('drop policy if exists %I on public.%I', t.tbl || '_ops_delete', t.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())',
                   t.tbl || '_staff_read', t.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.staff_can(''operations.write''))',
                   t.tbl || '_ops_insert', t.tbl);
    execute format('create policy %I on public.%I for update to authenticated using (public.staff_can(''operations.write'')) with check (public.staff_can(''operations.write''))',
                   t.tbl || '_ops_update', t.tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (public.staff_can(''operations.write''))',
                   t.tbl || '_ops_delete', t.tbl);
  end loop;
end $$;

-- ---------- hotel_rate_memory: the house room cost (audit M3) ----------
drop policy if exists hotel_rate_memory_staff_all on public.hotel_rate_memory;
drop policy if exists hotel_rate_memory_staff_read on public.hotel_rate_memory;
drop policy if exists hotel_rate_memory_offers_insert on public.hotel_rate_memory;
drop policy if exists hotel_rate_memory_offers_update on public.hotel_rate_memory;
drop policy if exists hotel_rate_memory_settings_delete on public.hotel_rate_memory;
create policy hotel_rate_memory_staff_read on public.hotel_rate_memory
  for select to authenticated using (public.is_staff());
create policy hotel_rate_memory_offers_insert on public.hotel_rate_memory
  for insert to authenticated with check (public.staff_can('offers.write'));
create policy hotel_rate_memory_offers_update on public.hotel_rate_memory
  for update to authenticated using (public.staff_can('offers.write')) with check (public.staff_can('offers.write'));
create policy hotel_rate_memory_settings_delete on public.hotel_rate_memory
  for delete to authenticated using (public.staff_can('settings.manage'));
revoke insert, update, delete on public.hotel_rate_memory from anon;

-- ---------- ready_offers: read only; written by ready-offers.ts (service, settings.manage) ----------
drop policy if exists authenticated_all on public.ready_offers;
drop policy if exists ready_offers_staff_read on public.ready_offers;
create policy ready_offers_staff_read on public.ready_offers
  for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.ready_offers from authenticated, anon;

-- ---------- the partner ledger: read only; written by the service role ----------
-- partner_*_partner_read (current_partner_id()) stay as they are.
drop policy if exists partner_invoices_staff on public.partner_invoices;
drop policy if exists partner_invoices_staff_read on public.partner_invoices;
create policy partner_invoices_staff_read on public.partner_invoices
  for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.partner_invoices from authenticated, anon;

drop policy if exists partner_payments_staff on public.partner_payments;
drop policy if exists partner_payments_staff_read on public.partner_payments;
create policy partner_payments_staff_read on public.partner_payments
  for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.partner_payments from authenticated, anon;

-- ---------- attendance: one heartbeat function, no direct writes (audit M4) ----------
-- The old app upsert wrote first_seen_at = now() on every beat, so «عين الإدارة»
-- reported the LAST heartbeat as the arrival; and the own_insert/own_update
-- policies let anyone PATCH their own arrival and beat count.
create or replace function public.touch_attendance() returns void
  language sql volatile security definer set search_path = public as $$
  insert into public.attendance_days as a (employee_id, day, first_seen_at, last_seen_at, beats)
  select e.id, (now() at time zone 'Asia/Riyadh')::date, now(), now(), 1
    from public.employees e
   where e.auth_user_id = auth.uid()
     and e.status = 'Active'
  on conflict (employee_id, day) do update
    set last_seen_at = now(),
        beats = a.beats + 1;
$$;
comment on function public.touch_attendance() is
  'The heartbeat''s day row: inserts the arrival once, then only moves last_seen_at and beats. The only writer of attendance_days (0073).';
revoke all on function public.touch_attendance() from public, anon;
grant execute on function public.touch_attendance() to authenticated;

drop policy if exists attendance_own_insert on public.attendance_days;
drop policy if exists attendance_own_update on public.attendance_days;
revoke insert, update, delete on public.attendance_days from authenticated, anon;

-- ---------- offers: the owner and the money are not a session's to UPDATE (audit H2) ----------
revoke update on public.offers from authenticated, anon;
grant update (serial, employee_id, destination, duration, offer_date, adults, children, infants,
              currency, status, pdf_url, pipeline_stage, source_kind, source_supplier_id,
              source_import_id, show_prices, valid_until)
  on public.offers to authenticated;

-- ---------- storage: partner logos (audit L11) ----------
alter policy brands_write on storage.objects
  using (bucket_id = 'brands' and public.staff_can('data.write'))
  with check (bucket_id = 'brands' and public.staff_can('data.write'));

notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (manual — run as one script; restores the pre-0073 posture,
-- including the M4 forgery and the H2/H3/H4/H5 holes):
--
-- do $$
-- declare t record;
-- begin
--   for t in select * from (values
--       ('operations','operations_authenticated_all'), ('operation_payments','operation_payments_authenticated_all'),
--       ('operation_bookings','operation_bookings_authenticated_all'), ('operation_dispatches','operation_dispatches_authenticated_all'),
--       ('operation_documents','operation_documents_authenticated_all'), ('operation_installments','operation_installments_staff'),
--       ('operation_alerts','operation_alerts_staff'), ('operation_issues','operation_issues_staff'),
--       ('operation_ratings','operation_ratings_staff'), ('operation_links','operation_links_staff'),
--       ('supplier_payments','supplier_payments_staff')) as v(tbl, old_policy)
--   loop
--     execute format('drop policy if exists %I on public.%I', t.tbl || '_staff_read', t.tbl);
--     execute format('drop policy if exists %I on public.%I', t.tbl || '_ops_insert', t.tbl);
--     execute format('drop policy if exists %I on public.%I', t.tbl || '_ops_update', t.tbl);
--     execute format('drop policy if exists %I on public.%I', t.tbl || '_ops_delete', t.tbl);
--     execute format('create policy %I on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t.old_policy, t.tbl);
--   end loop;
-- end $$;
--
-- drop policy if exists hotel_rate_memory_staff_read on public.hotel_rate_memory;
-- drop policy if exists hotel_rate_memory_offers_insert on public.hotel_rate_memory;
-- drop policy if exists hotel_rate_memory_offers_update on public.hotel_rate_memory;
-- drop policy if exists hotel_rate_memory_settings_delete on public.hotel_rate_memory;
-- create policy hotel_rate_memory_staff_all on public.hotel_rate_memory
--   for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- grant insert, update, delete on public.hotel_rate_memory to anon;
--
-- drop policy if exists ready_offers_staff_read on public.ready_offers;
-- create policy authenticated_all on public.ready_offers
--   for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- grant insert, update, delete on public.ready_offers to authenticated, anon;
--
-- drop policy if exists partner_invoices_staff_read on public.partner_invoices;
-- create policy partner_invoices_staff on public.partner_invoices
--   for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- grant insert, update, delete on public.partner_invoices to authenticated, anon;
-- drop policy if exists partner_payments_staff_read on public.partner_payments;
-- create policy partner_payments_staff on public.partner_payments
--   for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- grant insert, update, delete on public.partner_payments to authenticated, anon;
--
-- grant insert, update, delete on public.attendance_days to authenticated, anon;
-- create policy attendance_own_insert on public.attendance_days for insert to authenticated
--   with check (employee_id in (select e.id from public.employees e where e.auth_user_id = (select auth.uid())));
-- create policy attendance_own_update on public.attendance_days for update to authenticated
--   using (employee_id in (select e.id from public.employees e where e.auth_user_id = (select auth.uid())))
--   with check (employee_id in (select e.id from public.employees e where e.auth_user_id = (select auth.uid())));
-- (touch_attendance() stays: it needs no policy, and the app calls it.)
--
-- grant update on public.offers to authenticated, anon;
--
-- alter policy brands_write on storage.objects
--   using (bucket_id = 'brands' and public.is_staff())
--   with check (bucket_id = 'brands' and public.is_staff());
--
-- drop function if exists public.staff_can(text);   -- only once no policy uses it
-- notify pgrst, 'reload schema';
-- ============================================================================
