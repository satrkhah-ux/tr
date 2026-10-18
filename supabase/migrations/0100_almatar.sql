-- «المطار» (Almatar) — a partner that takes TRANSPORT only from us: airport
-- arrivals/departures, city and out-of-city tours, and land transfers in
-- Thailand, Malaysia and Indonesia, at the price list we sent them
-- (لائحة أسعار المواصلات — تطبيق المطار, 2026-10-15, valid through 2027-12).
--
-- Kept apart from our own data on purpose (the owner, 2026-10-18): nothing here
-- touches transfers, price_grid, tours or any existing row. Its prices, its
-- bookings and our profit on them live in almatar_* tables only.
--
-- Almatar is a booking_partners row (identity on its vouchers, suspend, team),
-- but with portal = 'transport': current_partner_id() now answers only for
-- PACKAGE partners, so an Almatar session reaches none of the partner policies
-- (drafts, offers, operations). Everything it sees goes through the service
-- role after the app checks the session — the same closed-RLS pattern as 0092,
-- because a booking row carries our margin and profit.

-- ------------------------------------------------------ booking_partners ----
alter table public.booking_partners
  add column if not exists portal text not null default 'packages';

alter table public.booking_partners
  drop constraint if exists booking_partners_portal_check,
  add constraint booking_partners_portal_check check (portal in ('packages', 'transport'));

create or replace function public.current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pu.partner_id
  from public.partner_users pu
  join public.booking_partners bp on bp.id = pu.partner_id
  where pu.auth_user_id = auth.uid()
    and pu.status = 'active'
    and bp.status = 'approved'
    and bp.portal = 'packages'
  limit 1;
$$;

revoke all on function public.current_partner_id() from public;
grant execute on function public.current_partner_id() to authenticated;

-- The company itself. Logo is uploaded by scripts/almatar-setup.mjs (brands bucket).
insert into public.booking_partners
  (name, name_latin, slug, status, portal, resells, active, brand_color, accent_color, website, approved_at, note)
values
  ('المطار', 'Almatar', 'almatar', 'approved', 'transport', false, true, '#7c3aed', '#f5c000', 'https://almatar.com', now(),
   'شريك مواصلات فقط (تايلاند، ماليزيا، إندونيسيا) — لائحة أسعار 2026-10-15، سارية حتى 2027-12.')
on conflict do nothing;

-- ------------------------------------------------------- almatar_services ----
-- One row per line of the price list, keyed by the list's own id. Prices are
-- what Almatar PAYS us (net, SAR, our profit inside — the owner, 2026-10-18).
create table if not exists public.almatar_services (
  id text primary key,
  country_code text not null check (country_code in ('TH', 'MY', 'ID')),
  country_ar text not null,
  name_ar text not null,
  scope_ar text not null,
  kind text not null check (kind in ('arrival', 'departure', 'tour_city', 'tour_out', 'intercity', 'hotel_transfer')),
  -- the destination's clock: the 24-hour and 12-hour rules are counted in it
  tz text not null,
  price_small numeric(10, 2) not null check (price_small > 0),
  price_medium numeric(10, 2) not null check (price_medium > 0),
  price_van10 numeric(10, 2) not null check (price_van10 > 0),
  -- a line the list itself flagged; kept exactly as sent
  review_note text,
  valid_through date not null default '2027-12-31',
  sort int not null default 0,
  active boolean not null default true
);

alter table public.almatar_services enable row level security;

-- do nothing on conflict: a price changed by hand later is never overwritten by a re-run
insert into public.almatar_services
  (id, country_code, country_ar, name_ar, scope_ar, kind, tz, price_small, price_medium, price_van10, review_note, sort)
values
  ('th-01', 'TH', 'تايلاند', 'استقبال من المطار إلى الفندق', 'جميع المدن', 'arrival', 'Asia/Bangkok', 130, 145, 189, null, 10),
  ('th-02', 'TH', 'تايلاند', 'توديع من الفندق إلى المطار', 'جميع المدن', 'departure', 'Asia/Bangkok', 130, 145, 189, null, 20),
  ('th-03', 'TH', 'تايلاند', 'جولات سياحية داخل المدينة', 'جميع المدن ما عدا كرابي وكوه ساموي', 'tour_city', 'Asia/Bangkok', 255, 270, 339, null, 30),
  ('th-04', 'TH', 'تايلاند', 'جولات سياحية خارج المدينة', 'شنغامي + بانكوك', 'tour_out', 'Asia/Bangkok', 350, 400, 455, null, 40),
  ('th-05', 'TH', 'تايلاند', 'جولات سياحية داخل المدينة', 'كرابي + كوة ساموي', 'tour_city', 'Asia/Bangkok', 350, 400, 455, null, 50),
  ('th-06', 'TH', 'تايلاند', 'سفر بري (نقلة)', 'فوكيت فندق أو مطار – كرابي أو العكس', 'intercity', 'Asia/Bangkok', 350, 400, 455, null, 60),
  ('th-07', 'TH', 'تايلاند', 'سفر بري (نقلة)', 'بانكوك فندق أو مطار – بتايا أو العكس', 'intercity', 'Asia/Bangkok', 215, 335, 280, 'للمراجعة: سعر فان 10 مقاعد (280) أقل من سعر الفئة المتوسطة (335) بحسب المستند؛ يلزم التحقق من المصدر قبل أي تعديل.', 70),
  ('my-01', 'MY', 'ماليزيا', 'استقبال من المطار إلى الفندق', 'كوالالمبور - سيلانجور', 'arrival', 'Asia/Kuala_Lumpur', 150, 165, 250, null, 80),
  ('my-02', 'MY', 'ماليزيا', 'توديع من الفندق إلى المطار', 'كوالالمبور - سيلانجور', 'departure', 'Asia/Kuala_Lumpur', 150, 165, 250, null, 90),
  ('my-03', 'MY', 'ماليزيا', 'استقبال من المطار إلى الفندق', 'جزيرة لنكاوي', 'arrival', 'Asia/Kuala_Lumpur', 75, 85, 230, null, 100),
  ('my-04', 'MY', 'ماليزيا', 'استقبال من المطار إلى الفندق', 'جزيرة بينانج', 'arrival', 'Asia/Kuala_Lumpur', 106, 140, 230, null, 110),
  ('my-05', 'MY', 'ماليزيا', 'استقبال من المطار إلى الفندق', 'سيلانجور- كوالالمبور "مرتفعات جينتنج والعكس"', 'arrival', 'Asia/Kuala_Lumpur', 290, 315, 410, null, 120),
  ('my-06', 'MY', 'ماليزيا', 'استقبال من المطار إلى الفندق', 'سيلانجور- كوالالمبور "مرتفعات كاميرون والعكس"', 'arrival', 'Asia/Kuala_Lumpur', 650, 750, 900, null, 130),
  ('my-07', 'MY', 'ماليزيا', 'استقبال من المطار إلى الفندق', 'سيلانجور- كوالالمبور "جزيرة بينانج والعكس"', 'arrival', 'Asia/Kuala_Lumpur', 750, 850, 950, null, 140),
  ('my-08', 'MY', 'ماليزيا', 'استقبال من المطار إلى الفندق', 'سيلانجور- كوالالمبور "ايبوه والعكس"', 'arrival', 'Asia/Kuala_Lumpur', 650, 750, 900, null, 150),
  ('my-09', 'MY', 'ماليزيا', 'جولات سياحية داخل المدينة', 'جميع المدن', 'tour_city', 'Asia/Kuala_Lumpur', 210, 250, 370, null, 160),
  ('my-10', 'MY', 'ماليزيا', 'جولات سياحية خارج المدينة', 'كوالالمبور أو سيلانجور "مرتفعات جينتنج هايلاند"', 'tour_out', 'Asia/Kuala_Lumpur', 300, 350, 600, null, 170),
  ('my-11', 'MY', 'ماليزيا', 'جولات سياحية خارج المدينة', 'كوالالمبور أو سيلانجور "مرتفعات كاميرون هايلاند"', 'tour_out', 'Asia/Kuala_Lumpur', 650, 750, 850, null, 180),
  ('my-12', 'MY', 'ماليزيا', 'جولات سياحية خارج المدينة', 'كوالالمبور أو سيلانجور "ايبوه"', 'tour_out', 'Asia/Kuala_Lumpur', 650, 750, 850, null, 190),
  ('my-13', 'MY', 'ماليزيا', 'جولات سياحية خارج المدينة', 'كوالالمبور أو سيلانجور "سفاري افموسا"', 'tour_out', 'Asia/Kuala_Lumpur', 450, 550, 750, null, 200),
  ('my-14', 'MY', 'ماليزيا', 'سفر بري (نقلة)', 'جزيرة بينانج – مرتفعات كاميرون هايلاند والعكس', 'intercity', 'Asia/Kuala_Lumpur', 650, 750, 900, null, 210),
  ('my-15', 'MY', 'ماليزيا', 'سفر بري (نقلة)', 'جزيرة بينانج – مرتفعات جينتنج هايلاند والعكس', 'intercity', 'Asia/Kuala_Lumpur', 650, 750, 900, null, 220),
  ('id-01', 'ID', 'إندونيسيا', 'استقبال من المطار إلى الفندق - جاكرتا', 'مطار جاكرتا إلى الفندق جاكرتا', 'arrival', 'Asia/Jakarta', 185, 210, 360, null, 230),
  ('id-02', 'ID', 'إندونيسيا', 'توديع من الفندق إلى المطار - جاكرتا', 'فندق جاكرتا – مطار جاكرتا', 'departure', 'Asia/Jakarta', 185, 210, 360, null, 240),
  ('id-03', 'ID', 'إندونيسيا', 'استقبال من المطار إلى الفندق', 'بالي', 'arrival', 'Asia/Makassar', 135, 170, 210, null, 250),
  ('id-04', 'ID', 'إندونيسيا', 'استقبال من مطار جاكرتا', 'من مطار جاكرتا إلى بونشاك والعكس', 'arrival', 'Asia/Jakarta', 210, 255, 360, null, 260),
  ('id-05', 'ID', 'إندونيسيا', 'استقبال من مطار جاكرتا', 'من مطار جاكرتا إلى باندونج والعكس', 'arrival', 'Asia/Jakarta', 255, 280, 360, null, 270),
  ('id-06', 'ID', 'إندونيسيا', 'سفر بري (نقلة)', 'بونشاك إلى باندونج والعكس', 'intercity', 'Asia/Jakarta', 220, 255, 360, null, 280),
  ('id-07', 'ID', 'إندونيسيا', 'الانتقال من فندق في بالي إلى فندق آخر في بالي', 'من فندق إلى فندق', 'hotel_transfer', 'Asia/Makassar', 135, 170, 210, null, 290),
  ('id-08', 'ID', 'إندونيسيا', 'جولات سياحية داخل المدينة', 'جميع المدن ما عدا (بالي)', 'tour_city', 'Asia/Jakarta', 230, 280, 360, null, 300),
  ('id-09', 'ID', 'إندونيسيا', 'جولات سياحية داخل المدينة', 'بالي', 'tour_city', 'Asia/Makassar', 160, 185, 230, null, 310),
  ('id-10', 'ID', 'إندونيسيا', 'سفر بري (نقلة)', 'جاكرتا إلى بونشاك والعكس', 'intercity', 'Asia/Jakarta', 210, 255, 360, null, 320)
on conflict (id) do nothing;

-- ------------------------------------------------------- almatar_settings ----
-- Our margin INSIDE their price, for the profit we book on each line. The list
-- names no percentage, so it starts at 15 (the partners' default) and the
-- administration edits it on /almatar-bookings.
create table if not exists public.almatar_settings (
  id boolean primary key default true check (id),
  margin_pct numeric(5, 2) not null default 15 check (margin_pct >= 0 and margin_pct < 100),
  updated_by uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.almatar_settings enable row level security;

insert into public.almatar_settings (id) values (true) on conflict do nothing;

-- ------------------------------------------------------- almatar_bookings ----
create sequence if not exists public.almatar_booking_seq;

create table if not exists public.almatar_bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('AM-' || lpad(nextval('public.almatar_booking_seq')::text, 5, '0')),
  partner_id uuid not null references public.booking_partners (id) on delete restrict,
  service_id text not null references public.almatar_services (id) on delete restrict,
  vehicle text not null check (vehicle in ('small', 'medium', 'van10')),
  -- term 12: eight vehicles or more is a group, by separate agreement only
  units int not null check (units between 1 and 7),
  service_date date not null,
  service_time time not null,
  -- the same moment as an instant, from the service's tz
  service_at timestamptz not null,
  passengers int not null check (passengers between 1 and 70),
  lead_name text not null check (length(btrim(lead_name)) > 0),
  lead_phone text,
  flight_no text,
  pickup text,
  dropoff text,
  notes text,
  -- frozen at booking: a later price or margin change never rewrites a booking
  unit_price numeric(10, 2) not null check (unit_price > 0),
  total_sar numeric(12, 2) not null check (total_sar > 0),
  margin_pct numeric(5, 2) not null,
  profit_sar numeric(12, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'cancelled')),
  status_note text,
  -- term 6: inside 12 hours a cancellation costs the whole price
  cancel_fee_pct int check (cancel_fee_pct in (0, 100)),
  cancel_fee_sar numeric(12, 2),
  cancelled_at timestamptz,
  -- what the voucher prints once we confirm: driver, car, phone
  driver_info text,
  voucher_token text unique,
  confirmed_by uuid references public.employees (id) on delete set null,
  confirmed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists almatar_bookings_partner_idx on public.almatar_bookings (partner_id, created_at desc);
create index if not exists almatar_bookings_status_idx on public.almatar_bookings (status, service_at);

alter table public.almatar_bookings enable row level security;

notify pgrst, 'reload schema';
