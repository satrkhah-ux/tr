-- App Travluin — cost data and privileges, locked before the first non-admin
-- employee is approved.
--
-- Every policy so far asks one question, is_staff(), and none asks WHICH staff.
-- That held while every login was an administrator. It stops holding the day a
-- salesperson signs in: their own token reaches PostgREST directly, and the
-- database — not the screen — is what has to say no.
--
-- Permissions live in the app (roles.permission_keys, read by current.ts), so
-- this does not teach the database the permission model. It does what 0039 did
-- for pricings: whatever only SOME staff may see is taken from every session,
-- and the app reads it through the service role behind an explicit currentCan()
-- check. No new SQL helper — the check lives in one place, in code.
--
-- READ, closed to sessions entirely:
--   offer_renders      the internal snapshot of every published offer IS the cost
--                      sheet (buy, net, markup, profit). publishOffer (offers.write
--                      or repackage.write; it returns no figure) and confirmOffer
--                      (operations.write) use the service role; nothing else reads it.
--   offer_drafts       buy prices and supplier nets sit inside `data`, and a
--                      column grant cannot hide part of a json value. Partners
--                      too: a stay priced from a supplier put our net and markup
--                      in the partner's own row, one GET away. Every draft is
--                      reached through draft-store.ts — offers.write sees all, a
--                      partner their own company's (the filter 0035's policy
--                      was) — and the cost leaves only for pricing.internal.
--   repackage_imports  a supplier's own price list — and the PDFs in the
--   + bucket repackage `repackage` bucket. repackage.ts: repackage.write.
--   profits,           the margin policy itself. The generic engine serves them
--   markup_rules       to pricing.internal only (the /markup-rules screen had
--                      been failing since 0039: it listed with `select *`).
--
-- READ, cost columns withheld (column grants — a column-list GRANT cannot narrow
-- a table-wide one, so each table is revoked and re-granted by name):
--   offer_hotels               buy / net / markup / supplier rate key.
--   services,                  buy_price, buy_currency. Partners included: 0036
--   transportation_types       opened these as carrying "no money", and
--                              services.buy_price was readable from the portal.
--   operation_bookings         quoted_net, prebook_net, net_charged (operations
--                              still sees them, through the service role).
--
-- WRITE, taken from sessions:
--   pricings, offer_pricing_items, offer_hotels — every write, INSERT included:
--   an inserted buy price was a forged profit on the executive dashboard and a
--   forged net for operations. Only the producer writes them (offer-insert.ts,
--   service role, figures computed on the server);
--   services / transportation_types buy_price, buy_currency — the cost basis
--   «اقتراح التسعير» prices from; pricing.internal edits it via the service role;
--   offer_status_history update/delete (an offer's audit trail); legacy_id_map (price
--   matching); booking_partners DELETE (it cascades to that partner's logins —
--   settings.manage, service role); employees / roles writes (already refused by
--   RLS since 0030, now by privilege too); TRUNCATE everywhere (it ignores RLS).
--   attendance_days / presence: a session writes its OWN row only — «عين الإدارة»
--   reports arrival times from these, and any colleague could rewrite them.
--
-- Not changed (owner's decision): transfers / tours stay readable to partners.

-- ---------- offer_renders: service role only ----------
drop policy if exists authenticated_all on public.offer_renders;
revoke all on public.offer_renders from anon, authenticated;

-- ---------- offer_drafts: service role only, partners included (draft-store.ts is the gate) ----------
drop policy if exists authenticated_all on public.offer_drafts;
drop policy if exists offer_drafts_partner on public.offer_drafts;
revoke all on public.offer_drafts from anon, authenticated;

-- ---------- repackage: table and bucket, service role only ----------
drop policy if exists authenticated_all on public.repackage_imports;
revoke all on public.repackage_imports from anon, authenticated;
drop policy if exists repackage_rw on storage.objects;

-- ---------- the margin policy: service role only ----------
drop policy if exists authenticated_all on public.profits;
revoke all on public.profits from anon, authenticated;
drop policy if exists authenticated_all on public.markup_rules;
revoke all on public.markup_rules from anon, authenticated;

-- ---------- offer_hotels: the buy side withheld (writes: see the cost figures below) ----------
revoke select on public.offer_hotels from authenticated;
grant select (id, offer_id, offer_city_id, hotel_id, hotel_name, room_type_id, room_type_name,
              rooms_count, board_type, check_in, check_out, nights, sell_price, sell_currency, sort,
              created_at, cancellation_policy, excluded_surcharges, valid_until, image_url, facilities,
              content_star_rating)
  on public.offer_hotels to authenticated;

-- ---------- services / transportation_types: buy price neither read nor written (staff AND partners) ----------
-- Mirrored in src/lib/data/table-config.ts GRANTED_COLUMNS (a test holds them together).
revoke select, insert, update on public.services from authenticated;
grant select (id, country_id, arabic_name, english_name, service_type, service_type_id,
              sell_price, sell_currency, created_at),
      insert (id, country_id, arabic_name, english_name, service_type, service_type_id,
              sell_price, sell_currency, created_at),
      update (id, country_id, arabic_name, english_name, service_type, service_type_id,
              sell_price, sell_currency, created_at)
  on public.services to authenticated;

revoke select, insert, update on public.transportation_types from authenticated;
grant select (id, arabic_name, english_name, category, vehicle_class, pax_capacity, luggage_capacity,
              with_driver, duration_unit, sell_price, sell_currency, status, created_at),
      insert (id, arabic_name, english_name, category, vehicle_class, pax_capacity, luggage_capacity,
              with_driver, duration_unit, sell_price, sell_currency, status, created_at),
      update (id, arabic_name, english_name, category, vehicle_class, pax_capacity, luggage_capacity,
              with_driver, duration_unit, sell_price, sell_currency, status, created_at)
  on public.transportation_types to authenticated;

-- ---------- operation_bookings: the nets withheld ----------
revoke select on public.operation_bookings from authenticated;
grant select (id, operation_id, kind, title, city_name, start_date, end_date, detail, supplier_code,
              supplier_name, source, status, supplier_status, client_reference, confirmation_number,
              supplier_booking_id, voucher_ref, currency, cancellation_policy, cancellation_deadline,
              prebook_at, confirmed_at, cancelled_at, created_by, confirmed_by, note, created_at, is_paid,
              paid_at, origin, origin_ref, assignee_kind, assignee_employee_id, assignee_partner_id,
              assigned_at, assigned_by, handoff_note, supplier_booking_code, supplier_ref)
  on public.operation_bookings to authenticated;

-- ---------- cost figures: no session writes them; history: insert-only ----------
revoke insert, update, delete on public.pricings, public.offer_pricing_items, public.offer_hotels
  from anon, authenticated;
revoke update, delete on public.offer_status_history from authenticated;
revoke insert, update, delete on public.legacy_id_map from authenticated;

-- ---------- privilege: belt and braces under 0030's RLS ----------
revoke insert, update, delete on public.employees, public.roles from anon, authenticated;
revoke delete on public.booking_partners from authenticated;

-- ---------- attendance / presence: your own row, nobody else's ----------
drop policy if exists attendance_write on public.attendance_days;
drop policy if exists attendance_own_insert on public.attendance_days;
create policy attendance_own_insert on public.attendance_days
  for insert to authenticated
  with check (employee_id in (select e.id from public.employees e where e.auth_user_id = (select auth.uid())));
drop policy if exists attendance_own_update on public.attendance_days;
create policy attendance_own_update on public.attendance_days
  for update to authenticated
  using (employee_id in (select e.id from public.employees e where e.auth_user_id = (select auth.uid())))
  with check (employee_id in (select e.id from public.employees e where e.auth_user_id = (select auth.uid())));

drop policy if exists authenticated_all on public.presence;
drop policy if exists presence_read on public.presence;
create policy presence_read on public.presence
  for select to authenticated
  using (public.is_staff());
drop policy if exists presence_own_insert on public.presence;
create policy presence_own_insert on public.presence
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and employee_id in (select e.id from public.employees e where e.auth_user_id = (select auth.uid())));
drop policy if exists presence_own_update on public.presence;
create policy presence_own_update on public.presence
  for update to authenticated
  using (employee_id in (select e.id from public.employees e where e.auth_user_id = (select auth.uid())))
  with check (user_id = (select auth.uid())
              and employee_id in (select e.id from public.employees e where e.auth_user_id = (select auth.uid())));

-- ---------- TRUNCATE ignores RLS; no session has a use for it ----------
revoke truncate on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate on tables from anon, authenticated;

notify pgrst, 'reload schema';
