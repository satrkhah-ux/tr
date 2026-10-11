-- Lock down what a logged-in NON-staff account can touch.
--
-- Partner logins (and, from 0046, approved-but-not-yet-linked staff) are
-- `authenticated` without being staff. A few policies were written for
-- "authenticated" and so let such an account read the legacy id map, read
-- the service types, and WRITE to four storage buckets — including
-- overwriting the company and airline logos printed on client documents.
-- Every one of them now requires is_staff() (or, for the partner read, an
-- actual partner).
--
-- Also: any staff session could mint partner access (partner_users) or set a
-- partner's commercial terms (booking_partners.status / price_adjust_pct).
-- Approval and issuing run with the service role, so staff sessions keep only
-- the booking_partners columns the app's staff screens actually write.

alter policy legacy_id_map_authenticated_all on public.legacy_id_map
  using (public.is_staff()) with check (public.is_staff());

alter policy service_types_partner_read on public.service_types
  using (public.current_partner_id() is not null);

alter policy airlines_logo_write on storage.objects
  using (bucket_id = 'airlines' and public.is_staff())
  with check (bucket_id = 'airlines' and public.is_staff());
alter policy brands_write on storage.objects
  using (bucket_id = 'brands' and public.is_staff())
  with check (bucket_id = 'brands' and public.is_staff());
alter policy "guide authenticated manage" on storage.objects
  using (bucket_id = 'guide' and public.is_staff())
  with check (bucket_id = 'guide' and public.is_staff());
alter policy repackage_rw on storage.objects
  using (bucket_id = 'repackage' and public.is_staff())
  with check (bucket_id = 'repackage' and public.is_staff());

-- An employee row with a NULL status was treated as active. Every employee is
-- 'Active' today (verified 2026-10-11), so this only closes the gap.
create or replace function public.is_staff() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees where auth_user_id = auth.uid() and status = 'Active'
  );
$$;

revoke insert, update, delete on public.partner_users from authenticated;

revoke insert, update on public.booking_partners from authenticated;
grant insert (name, name_latin, kinds, contact_name, phone, email, note, active, logo_path,
              brand_color, accent_color, address, whatsapp, website, resells, slug, doc_font)
  on public.booking_partners to authenticated;
grant update (name, name_latin, kinds, contact_name, phone, email, note, active, logo_path,
              brand_color, accent_color, address, whatsapp, website, resells, slug, doc_font)
  on public.booking_partners to authenticated;
