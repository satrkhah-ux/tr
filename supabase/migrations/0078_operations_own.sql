-- ============================================================================
-- 0078 — operations.own: a salesperson works the operations of THEIR files
--
-- The owner's order (2026-10-17): sales get «العمليات» as «ملفاته فقط، يشاهد
-- ويعمل». The permission key `operations.own` (roles.ts) is that: the same
-- screens as operations.write, on the operations whose offer the employee
-- issued — offers.employee_id, «الموظف المختص» on the document, stamped with
-- the issuer when the offer is produced (offer-insert.ts). The app's half of
-- the rule is src/lib/operations/access.ts; this is the database's, so a
-- session cannot skip the app by calling PostgREST with its own token (the
-- 0073 lesson).
--
--  · public.owns_offer(o) / public.owns_operation(op) — the signed-in user is
--    the ACTIVE employee named on the offer (of that operation). SECURITY
--    DEFINER: they read offers / employees / operations whatever the caller's
--    own policies say. Pinned by src/lib/operations/access.test.ts (the app's
--    mirror, mayWork).
--  · WRITE policies added BESIDE 0073's operations.write ones (permissive
--    policies are OR-ed, so ops / visa / the owner keep exactly what they had),
--    each `staff_can('operations.own') and <the row's file is mine>`, and only
--    the commands the own-files actions actually run:
--      operations            UPDATE — never into «ملغي»: cancelling a case is
--                            the manager's; and the row's offer must stay mine
--                            (offer_id is session-updatable).
--      operation_bookings    INSERT / UPDATE / DELETE — a DELETE never of a
--                            confirmed or in-flight booking (those are
--                            cancelled, not erased — deleteBooking says the same).
--      operation_documents   INSERT / UPDATE (issue, revoke a voucher).
--      operation_dispatches  INSERT (the request / driver card / client message log).
--      operation_issues      INSERT / UPDATE.
--      operation_payments    INSERT of money IN only (no refund). No UPDATE or
--                            DELETE: correcting or erasing a money record is
--                            the manager's; the receipt number and the slip's
--                            path are written by the service role behind the
--                            app's gate (operation-payments.ts).
--    Nothing for operation_installments (the client's payment terms),
--    supplier_payments (money to suppliers), operation_alerts / _ratings
--    (written by the service role only) — those stay operations.write.
--    operation_travelers, operation_passport_submissions, supplier_calls and
--    operation_links have no session policy / grant at all and stay that way:
--    the app gates them (service role).
--  · READS are NOT narrowed. Reads stay `is_staff()` for every staff role,
--    because other features read these tables through the user's session as
--    any staff and would silently UNDER-count for an own-files holder — and
--    sales (data.write) run them: the hotel usage check before a hotel is
--    merged or deleted (hotel-tools.ts), the «in use» guard before a partner
--    company is hard-deleted (partner-companies.ts deletePartnerCompany), the
--    partner company page's cases and payments. An undercount there deletes a
--    row that is in use. The app shows an own-files holder their own cases only
--    (listOperations, the board, the dashboard panel, the drivers' sheet), and
--    every cost column stays closed to sessions as before (0047/0063).
--  · offers.employee_id is FIXED once the file is in operations, unless the
--    session holds operations.write (or it is the service role): otherwise a
--    one-field PATCH of a colleague's confirmed offer would make their
--    operation «mine». No app path changes the issuer after issue.
--
-- Deploy order: the app (access.ts) first — it routes the payment receipt /
-- slip writes through the service role; then this migration. Idempotent.
-- ============================================================================

-- ---------- the helpers ----------
create or replace function public.owns_offer(o uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.offers f
      join public.employees e on e.id = f.employee_id
     where f.id = o
       and e.auth_user_id = auth.uid()
       and e.status = 'Active'
  );
$$;
comment on function public.owns_offer(uuid) is
  'The signed-in user is the Active employee named on the offer (offers.employee_id, its issuer). operations.own (0078).';
revoke all on function public.owns_offer(uuid) from public, anon;
grant execute on function public.owns_offer(uuid) to authenticated, service_role;

create or replace function public.owns_operation(op uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.operations o where o.id = op and public.owns_offer(o.offer_id)
  );
$$;
comment on function public.owns_operation(uuid) is
  'The operation''s offer was issued by the signed-in Active employee. operations.own (0078).';
revoke all on function public.owns_operation(uuid) from public, anon;
grant execute on function public.owns_operation(uuid) to authenticated, service_role;

-- ---------- operations: UPDATE, never into «ملغي», the offer stays mine ----------
drop policy if exists operations_own_update on public.operations;
create policy operations_own_update on public.operations
  for update to authenticated
  using (public.staff_can('operations.own') and public.owns_offer(offer_id))
  with check (
    public.staff_can('operations.own') and public.owns_offer(offer_id)
    and client_status <> 'cancelled' and execution_status <> 'cancelled'
  );

-- ---------- operation_bookings: INSERT / UPDATE / DELETE (not a confirmed one) ----------
drop policy if exists operation_bookings_own_insert on public.operation_bookings;
drop policy if exists operation_bookings_own_update on public.operation_bookings;
drop policy if exists operation_bookings_own_delete on public.operation_bookings;
create policy operation_bookings_own_insert on public.operation_bookings
  for insert to authenticated
  with check (public.staff_can('operations.own') and public.owns_operation(operation_id));
create policy operation_bookings_own_update on public.operation_bookings
  for update to authenticated
  using (public.staff_can('operations.own') and public.owns_operation(operation_id))
  with check (public.staff_can('operations.own') and public.owns_operation(operation_id));
create policy operation_bookings_own_delete on public.operation_bookings
  for delete to authenticated
  using (
    public.staff_can('operations.own') and public.owns_operation(operation_id)
    and status not in ('confirmed', 'in_flight')
  );

-- ---------- operation_documents: issue / revoke ----------
drop policy if exists operation_documents_own_insert on public.operation_documents;
drop policy if exists operation_documents_own_update on public.operation_documents;
create policy operation_documents_own_insert on public.operation_documents
  for insert to authenticated
  with check (public.staff_can('operations.own') and public.owns_operation(operation_id));
create policy operation_documents_own_update on public.operation_documents
  for update to authenticated
  using (public.staff_can('operations.own') and public.owns_operation(operation_id))
  with check (public.staff_can('operations.own') and public.owns_operation(operation_id));

-- ---------- operation_dispatches: the sent-message log ----------
drop policy if exists operation_dispatches_own_insert on public.operation_dispatches;
create policy operation_dispatches_own_insert on public.operation_dispatches
  for insert to authenticated
  with check (public.staff_can('operations.own') and public.owns_operation(operation_id));

-- ---------- operation_issues: problems during the trip ----------
drop policy if exists operation_issues_own_insert on public.operation_issues;
drop policy if exists operation_issues_own_update on public.operation_issues;
create policy operation_issues_own_insert on public.operation_issues
  for insert to authenticated
  with check (public.staff_can('operations.own') and public.owns_operation(operation_id));
create policy operation_issues_own_update on public.operation_issues
  for update to authenticated
  using (public.staff_can('operations.own') and public.owns_operation(operation_id))
  with check (public.staff_can('operations.own') and public.owns_operation(operation_id));

-- ---------- operation_payments: money IN only, never edited or erased ----------
drop policy if exists operation_payments_own_insert on public.operation_payments;
create policy operation_payments_own_insert on public.operation_payments
  for insert to authenticated
  with check (
    public.staff_can('operations.own') and public.owns_operation(operation_id)
    and kind <> 'refund'
  );

-- ---------- offers: the issuer is fixed once the file is in operations ----------
create or replace function public.offers_owner_locked() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is distinct from old.employee_id
     and auth.uid() is not null
     and not public.staff_can('operations.write')
     and exists (select 1 from public.operations o where o.offer_id = old.id) then
    raise exception 'offers.employee_id is fixed once the file is in operations (0078)'
      using errcode = '42501';
  end if;
  return new;
end $$;
comment on function public.offers_owner_locked() is
  'Refuses a session''s change of offers.employee_id once the offer has an operation, unless it holds operations.write — the issuer decides operations.own (0078).';

drop trigger if exists offers_owner_locked on public.offers;
create trigger offers_owner_locked
  before update of employee_id on public.offers
  for each row execute function public.offers_owner_locked();

notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (manual — run as one script; back to 0073: operations writes are
-- operations.write only, the issuer of a confirmed file is editable again):
--
-- drop trigger if exists offers_owner_locked on public.offers;
-- drop function if exists public.offers_owner_locked();
-- drop policy if exists operations_own_update on public.operations;
-- drop policy if exists operation_bookings_own_insert on public.operation_bookings;
-- drop policy if exists operation_bookings_own_update on public.operation_bookings;
-- drop policy if exists operation_bookings_own_delete on public.operation_bookings;
-- drop policy if exists operation_documents_own_insert on public.operation_documents;
-- drop policy if exists operation_documents_own_update on public.operation_documents;
-- drop policy if exists operation_dispatches_own_insert on public.operation_dispatches;
-- drop policy if exists operation_issues_own_insert on public.operation_issues;
-- drop policy if exists operation_issues_own_update on public.operation_issues;
-- drop policy if exists operation_payments_own_insert on public.operation_payments;
-- drop function if exists public.owns_operation(uuid);
-- drop function if exists public.owns_offer(uuid);
-- notify pgrst, 'reload schema';
-- ============================================================================
