-- ═══════════════════════════════════════════════════════════════════════════
-- App Travluin / Traveliun — FULL DATABASE (schema + reference seed + admin)
-- Consolidated from supabase/migrations/0001..0017 in order.
--
-- Apply ONCE against a FRESH Supabase project (cloud OR self-hosted).
-- REQUIRES a real Supabase (not plain Postgres): migration 0002 inserts into
-- auth.users, and later migrations rely on the Supabase auth/storage schemas.
--
-- How to run:
--   • Cloud Supabase:  paste into Dashboard → SQL Editor → Run
--   • Self-hosted:     psql "$DB_URL" -f deploy/deploy-all.sql
--
-- Default admin after seeding:  admin@admin.com  /  Traveliun#2026
-- (⚠ change this password after first login — it is public in the repo.)
-- Does NOT include your LIVE data (offers/employees you entered) — only the
-- schema + reference seed. Ask to export live data separately if needed.
-- ═══════════════════════════════════════════════════════════════════════════



-- ═══════════════ 0001_init.sql ═══════════════

-- App Travluin — data foundation schema
-- Mirrors src/lib/types.ts. Run before seed.sql.
--
-- Entities: Country, City, Hotel, RoomType, Service, Term, Flight, Customer,
-- Employee, Role, Offer, OfferCity, OfferFlight, OfferService, OfferTerm,
-- Pricing, OfferRevision.

create extension if not exists pgcrypto;

-- ---------- enums ----------
do $$ begin
  create type public.term_kind as enum ('include', 'exclude', 'term');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.offer_service_kind as enum ('include', 'exclude');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.offer_status as enum ('draft', 'sent', 'confirmed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------- reference tables ----------
create table if not exists public.countries (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  code text,
  default_currency text,
  weekend text,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  country_id uuid references public.countries (id) on delete set null,
  arabic_name text not null,
  english_name text,
  default_hotel text,
  created_at timestamptz not null default now()
);

create table if not exists public.hotels (
  id uuid primary key default gen_random_uuid(),
  city_id uuid references public.cities (id) on delete set null,
  country_id uuid references public.countries (id) on delete set null,
  arabic_name text not null,
  english_name text,
  stars int,
  address text,
  google_maps text,
  contact_number text,
  website text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.room_types (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  country_id uuid references public.countries (id) on delete set null,
  arabic_name text,
  english_name text,
  service_type text,
  buy_price numeric(12, 2),
  buy_currency text,
  sell_price numeric(12, 2),
  sell_currency text,
  created_at timestamptz not null default now()
);

create table if not exists public.terms (
  id uuid primary key default gen_random_uuid(),
  kind public.term_kind not null,
  arabic_text text not null,
  english_text text,
  checked boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.flights (
  id uuid primary key default gen_random_uuid(),
  carrier text,
  from_airport text,
  to_airport text,
  flight_date date,
  passengers int,
  baggage text,
  cabin text,
  type text,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company text,
  arabic_name text not null,
  english_name text,
  mobile text,
  email text,
  second_mobile text,
  birth_date date,
  passport_first_name text,
  passport_last_name text,
  passport_number text,
  passport_issue_date date,
  passport_expiry_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  email text,
  mobile text,
  role_id uuid references public.roles (id) on delete set null,
  type text,
  status text not null default 'Active',
  auth_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- offers ----------
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  serial text not null unique,
  customer_id uuid references public.customers (id) on delete set null,
  employee_id uuid references public.employees (id) on delete set null,
  destination text,
  duration text,
  offer_date date,
  adults int not null default 0,
  children int not null default 0,
  infants int not null default 0,
  total numeric(12, 2),
  currency text,
  status public.offer_status not null default 'draft',
  pdf_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_cities (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  city_name text not null,
  hotel_name text,
  room_type text,
  check_in date,
  check_out date,
  nights int,
  meals text,
  stars int,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_flights (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  flight_date date,
  passengers int,
  carrier text,
  from_airport text,
  to_airport text,
  baggage text,
  cabin text,
  type text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_services (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  label text not null,
  kind public.offer_service_kind not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_terms (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  text text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.pricings (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.offers (id) on delete cascade,
  total numeric(12, 2),
  currency text,
  buy_total numeric(12, 2),
  sell_total numeric(12, 2),
  profit numeric(12, 2),
  created_at timestamptz not null default now()
);

create table if not exists public.offer_revisions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  revision int not null default 1,
  snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

-- ---------- indexes ----------
create index if not exists cities_country_id_idx on public.cities (country_id);
create index if not exists hotels_city_id_idx on public.hotels (city_id);
create index if not exists hotels_country_id_idx on public.hotels (country_id);
create index if not exists services_country_id_idx on public.services (country_id);
create index if not exists employees_role_id_idx on public.employees (role_id);
create index if not exists employees_auth_user_id_idx on public.employees (auth_user_id);
create index if not exists offers_customer_id_idx on public.offers (customer_id);
create index if not exists offers_employee_id_idx on public.offers (employee_id);
create index if not exists offer_cities_offer_id_idx on public.offer_cities (offer_id);
create index if not exists offer_flights_offer_id_idx on public.offer_flights (offer_id);
create index if not exists offer_services_offer_id_idx on public.offer_services (offer_id);
create index if not exists offer_terms_offer_id_idx on public.offer_terms (offer_id);
create index if not exists offer_revisions_offer_id_idx on public.offer_revisions (offer_id);

-- ---------- row-level security ----------
-- Internal admin tool: any authenticated employee has full access. Public
-- (anon) may only READ offers and their children so that shareable
-- /client-offer/[serial] links work without a login.

do $$
declare
  t text;
  authed_tables text[] := array[
    'countries','cities','hotels','room_types','services','terms','flights',
    'customers','roles','employees','offers','offer_cities','offer_flights',
    'offer_services','offer_terms','pricings','offer_revisions'
  ];
  public_read_tables text[] := array[
    'offers','offer_cities','offer_flights','offer_services','offer_terms','pricings'
  ];
begin
  foreach t in array authed_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists authenticated_all on public.%I;', t);
    execute format(
      'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true);', t);
  end loop;

  foreach t in array public_read_tables loop
    execute format('drop policy if exists public_read on public.%I;', t);
    execute format('create policy public_read on public.%I for select to anon using (true);', t);
  end loop;
end $$;


-- ═══════════════ 0002_seed.sql ═══════════════

-- App Travluin — seed data (GENERATED by scripts/generate-seed.mjs; do not edit by hand)
-- Migrates the former static data (traveliun-pages.generated.json + offer sample) into SQL.
-- Run after 0001_init.sql. Safe to re-run: domain tables are truncated first.


truncate table
  public.offer_revisions, public.pricings, public.offer_terms, public.offer_services,
  public.offer_flights, public.offer_cities, public.offers, public.employees, public.roles,
  public.customers, public.terms, public.flights, public.services, public.hotels,
  public.room_types, public.cities, public.countries
  restart identity cascade;

-- countries
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('ماليزيا', 'MALASYIA', 'Ringgit Malaysia', 'Saturday, Sunday');
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('اندونيسيا', 'Indonesia', 'Indonesian rupiah', 'Sunday, Saturday');
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('فرنسا', 'Fransa', NULL, NULL);
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('تركيا', 'Turkiye', 'USD', 'Sunday, Saturday');
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('روسيا', 'russia', 'Russian ruble', 'Saturday, Sunday');
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('تايلاند', 'Thailand', 'Thai baht', 'Sunday, Saturday');
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('سويسرا', 'Switzerland', NULL, NULL);
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('السعوديه', 'Saudi Arabia', 'SAR', NULL);
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('كوريا الجنوبية', 'South Korea', NULL, NULL);
insert into public.countries (arabic_name, english_name, default_currency, weekend) values ('المغرب', 'Morocco', NULL, NULL);

-- cities (linked to countries by english_name)
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'MALASYIA' limit 1), 'كوالالمبور', 'Kuala Lumpur', 'Hotel Stripes Kuala Lumpur Autograph Collection');
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'Indonesia' limit 1), 'جاكرتا', 'Jakarta', 'Novotel Jakarta Cikini Hotel');
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'Indonesia' limit 1), 'بالي', 'BALI', 'tanadewa villas nusa dua bali by cross collection');
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'MALASYIA' limit 1), 'لنكاوي', 'Langkawi', 'Bayview Hotel Langkawi');
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'MALASYIA' limit 1), 'بينانج', 'Penang', 'Hompton Hotel by the Beach');
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'MALASYIA' limit 1), 'سيلانجور', 'Selangor', 'Sunway Pyramid Hotel');
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'Indonesia' limit 1), 'بونشاك', 'Puncak', 'Grand ASTON Puncak Hotel and Resort');
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'Indonesia' limit 1), 'باندونج', 'Bandung', 'Mercure Bandung City Centre');
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'MALASYIA' limit 1), 'جنتنج هايلاند', 'Genting Highlands', NULL);
insert into public.cities (country_id, arabic_name, english_name, default_hotel) values ((select id from public.countries where english_name = 'Turkiye' limit 1), 'اسطنبول', 'Istanbul', 'Mercure Istanbul Bomonti');

-- room_types
insert into public.room_types (arabic_name, english_name) values ('جناح تيفاني', 'Tiffany Suite');
insert into public.room_types (arabic_name, english_name) values ('غرفة ديولكس مطلة على البحر', 'deluxe sea view');
insert into public.room_types (arabic_name, english_name) values ('غرفة تنفيذية', 'Executive Room');
insert into public.room_types (arabic_name, english_name) values ('غرفة وصالة', 'Suit one bedroom');
insert into public.room_types (arabic_name, english_name) values ('غرفتان وصالة', 'Suit two bedroom');
insert into public.room_types (arabic_name, english_name) values ('ثلاث غرف وصالة', 'Suit three bedrooms');
insert into public.room_types (arabic_name, english_name) values ('غرفة ضيافه ميليا', 'guest room');
insert into public.room_types (arabic_name, english_name) values ('غرفة ضيافة بريمير', 'Premier guest room');
insert into public.room_types (arabic_name, english_name) values ('عائليه من غرفتين نوم', 'Two bedroom family');
insert into public.room_types (arabic_name, english_name) values ('ديلوكس بارك', 'Deluxe Park');

-- roles
insert into public.roles (arabic_name, english_name) values ('كل الصلاحيات', 'All Permissions');
insert into public.roles (arabic_name, english_name) values ('مبيعات', 'sales');
insert into public.roles (arabic_name, english_name) values ('الاوبريشن', 'Operation');
insert into public.roles (arabic_name, english_name) values ('التأشيرات', 'Visa');

-- employees (email in the source 'mobile' column; role name in 'type' column)
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('أدمن', 'Admin', 'admin@admin.com', 'Company Employee', (select id from public.roles where english_name = 'All Permissions' limit 1), 'Active');
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('عبد الرزاق', 'abd alrazaq', 'abdulrazak@traveliun.com', 'Company Employee', (select id from public.roles where english_name = 'sales' limit 1), 'Active');
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('ايمان الهاشمي', 'imenelhachmi', 'imen.elhachmi@traveliun.com', 'Company Employee', (select id from public.roles where english_name = 'All Permissions' limit 1), 'Active');
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('احمد يوسف', 'ahmed yousif', 'sales.ksa@traveliun.com', 'Company Employee', (select id from public.roles where english_name = 'All Permissions' limit 1), 'Active');
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('رهف', 'rahaf', 'rahaf@traveliun.com', 'Company Employee', (select id from public.roles where english_name = 'All Permissions' limit 1), 'Active');
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('ريم', 'reem', 'visa1@traveliun.com', 'Company Employee', (select id from public.roles where english_name = 'Visa' limit 1), 'Active');
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('محمد صالح', 'saleh', 'saleh@traveliun.com', 'Company Employee', (select id from public.roles where english_name = 'All Permissions' limit 1), 'Active');
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('نسرين', 'visa', 'visa@traveliun.com', 'Company Employee', (select id from public.roles where english_name = 'Visa' limit 1), 'Active');
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('هاني', 'accounts', 'accounts@traveliun.com', 'Company Employee', (select id from public.roles where english_name = 'All Permissions' limit 1), 'Active');
insert into public.employees (arabic_name, english_name, email, type, role_id, status) values ('عبدالله', 'Abdullah', 'abdallah_ali@traveliun.com', 'Company Employee', (select id from public.roles where english_name = 'All Permissions' limit 1), 'Active');

-- customers
insert into public.customers (company, arabic_name, english_name) values ('Traveliun Travel and Tourism', 'نايف الزهراني', '501040930');
insert into public.customers (company, arabic_name, english_name) values ('Traveliun Travel and Tourism', 'ابو يوسف', '560007380');
insert into public.customers (company, arabic_name, english_name) values ('Traveliun Travel and Tourism', '+966537733106', '+966537733106');
insert into public.customers (company, arabic_name, english_name) values ('Traveliun Travel and Tourism', 'الأستاذة هند', '+966544072627');
insert into public.customers (company, arabic_name, english_name) values ('Traveliun Travel and Tourism', 'رؤى الردادي', '0553300417');
insert into public.customers (company, arabic_name, english_name) values ('Traveliun Travel and Tourism', 'امجد', '+966583878771');
insert into public.customers (company, arabic_name, english_name) values ('Traveliun Travel and Tourism', 'الاستاذ بندر حسين', '0566669980');
insert into public.customers (company, arabic_name, english_name) values ('الأستاذه أم كريم', '966561003748+', NULL);
insert into public.customers (company, arabic_name, english_name) values ('Traveliun Travel and Tourism', '+966562328513', '+966562328513');
insert into public.customers (company, arabic_name, english_name) values ('Traveliun Travel and Tourism', '+966561310170', '+966561310170');
insert into public.customers (company, arabic_name) select 'Traveliun Travel and Tourism', 'نايف الجهني' where not exists (select 1 from public.customers where arabic_name = 'نايف الجهني');

-- terms catalog
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'الفنادق', 'HOTELS', true, 0);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'وجبة الإفطار', 'BREAKFAST', true, 1);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'الإستقبال والتوديع من المطار إلى الفندق والعكس', 'Reception and farewell from the airport to the hotel and vice versa', true, 2);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'الجولات السياحية', 'Tours', true, 3);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'الطيران الداخلي', 'Domestic flight', true, 4);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'الطيران الدولي', 'International flight', false, 5);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'شريحة إتصال وباقة انترنت', 'Internet and calls sim card', false, 6);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'خدمة عملاء 24 ساعة بالعربي', 'hour customer service in english 24', true, 7);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'جميع الجولات السياحية والتنقلات بسيارة خاصة بكم فقط', 'All tours and transfers by your own private car only', true, 8);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('include', 'شامل جميع الضرائب والرسوم ماعدا ضريبة المدينة إن وجدت', 'All taxes and fees included except city tax if applicable.', true, 9);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('exclude', 'الطيران الدولي', 'International flight', false, 0);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('exclude', 'وجبة الغداء والعشاء', 'Lunch and dinner', true, 1);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('exclude', 'رسوم تذاكر دخول الأماكن السياحية', 'Tourist entrance tickets', true, 2);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'في حال لم يكن حجم السيارة ملائمًا لعدد الركاب والأمتعة يُرجى إعلامنا مسبقًا نود التنويه بأن الأسعار تختلف حسب حجم السيارة', 'If the size of the car is not suitable for the number of passengers and luggage, please inform us in advance. We would like to note that prices vary according to the size of the car', true, 0);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'عبارة ( يوم حر ) المدرجة في البرنامج تعني أن الشركة غير مسؤولة عن تأمين سيارة للعميل في ذلك اليوم وأن للعميل حرية اختيار الأماكن التي يرغب في زيارتها والطريقة التي يفضلها', 'The phrase (free day) included in the program means that the company is not responsible for securing a car for the customer on that day and that the customer has the freedom to choose the places he wants to visit and the method he prefers.', true, 1);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'يُطلب من العميل التحقق من الموظف المسؤول حول توفر الفنادق في التواريخ المدرجة في البرنامج قبل تثبيت الحجز', 'The Customer is requested to check with the responsible employee about the availability of hotels on the dates listed in the program before confirming the reservation', true, 2);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'جميع الحجوزات في الفنادق غير قابلة للإلغاء أو الاسترجاع أو التعديل', 'All hotel reservations are not subject to cancellation, refund or modification', true, 3);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'السيارة الصغيرة تتسع لشخصين بالغين وحقيبتين كبيرتين', 'The small car can accommodate two adults with two large bags', true, 4);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'جميع الجولات المدرجة في البرنامج هي مقترحات قابلة للتعديل حسب رغباتكم مع التنسيق مع السائق عند الوصول بشرط أن تكون داخل نطاق المدينة', 'All tours included in the program are proposals that can be modified according to your desires, with coordination with the driver upon arrival, provided that they are within the city limits', true, 5);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'نوع السرير في الغرفة سواء كان سريرًا كبيرًا أو سريرين منفصلين يتم تحديده من قبل الفندق عند الوصول', 'The type of bed in the room, whether it is a king size bed or two separate beds, is determined by the hotel upon arrival', true, 6);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'مدة الجولة السياحية هي 8 ساعات فقط ولا تشمل تذاكر الدخول إلى الأماكن السياحية', 'The duration of the tour is only 8 hours and does not include entry tickets to tourist attractions', true, 7);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'تجنبًا للأخطاء يُرجى فحص البرنامج والغرف المذكورة في البرنامج المرسل من قبلنا قبل التأكيد', 'To avoid errors, please check the program and rooms mentioned in the program sent by us before confirming', true, 8);
insert into public.terms (kind, arabic_text, english_text, checked, sort) values ('term', 'في حال عدم توفر الغرفة أو الفندق المرسلة من قبلنا سيتم اقتراح فندق بديل يتمتع بنفس المستوى والجودة', 'If the room or hotel sent by us is not available an alternative hotel of the same level and quality will be suggested', true, 9);

-- hotels (from offer sample)
insert into public.hotels (city_id, arabic_name, stars, is_default) values ((select id from public.cities where arabic_name = 'كوالالمبور' limit 1), 'فندق سترايبس كوالالمبور أوتوجراف كوليكشن', 5, false);
insert into public.hotels (city_id, arabic_name, stars, is_default) values ((select id from public.cities where arabic_name = 'لنكاوي' limit 1), 'فندق باي فيو لنكاوي', 4, false);

-- sample offer with all children
with new_offer as (
  insert into public.offers (serial, customer_id, employee_id, destination, duration, offer_date, adults, children, infants, total, currency, status, pdf_url)
  values ('AD-1-1057-20260624',
    (select id from public.customers where arabic_name = 'نايف الجهني' limit 1),
    (select id from public.employees where english_name = 'Admin' limit 1),
    'ماليزيا', '7 ليالي - 8 أيام', '2026-06-24', 2, 0, 0, 7368.19, 'ريال سعودي', 'confirmed', '/offers/AD-1-1057-20260624.pdf')
  returning id
)
insert into public.offer_cities (offer_id, city_name, hotel_name, room_type, check_in, check_out, nights, meals, stars, sort)
select id, v.* from new_offer, (values
  ('كوالالمبور', 'فندق سترايبس كوالالمبور أوتوجراف كوليكشن', 'ديلوكس', '2026-06-24'::date, '2026-06-29'::date, 5, 'شامل الإفطار', 5, 0),
  ('لنكاوي', 'فندق باي فيو لنكاوي', 'غرفة سوبيريور', '2026-06-29'::date, '2026-07-01'::date, 2, 'شامل الإفطار والغداء والعشاء', 4, 1)
) as v(city_name, hotel_name, room_type, check_in, check_out, nights, meals, stars, sort);

insert into public.offer_flights (offer_id, flight_date, passengers, carrier, from_airport, to_airport, baggage, cabin, type, sort)
select o.id, v.* from public.offers o, (values
  ('2026-06-29'::date, 2, 'الخطوط الجوية العربية السعودية', 'مطار كوالالمبور الدولي', 'مطار لنكاوي الدولي', '20 كيلو', '7 كيلو', 'رحلة مباشرة', 0)
) as v(flight_date, passengers, carrier, from_airport, to_airport, baggage, cabin, type, sort) where o.serial = 'AD-1-1057-20260624';

insert into public.offer_services (offer_id, label, kind, sort)
select o.id, v.label, v.kind::public.offer_service_kind, v.sort from public.offers o, (values
  ('الفنادق', 'include', 0),
  ('وجبة الإفطار', 'include', 1),
  ('الاستقبال والتوديع من المطار إلى الفندق والعكس', 'include', 2),
  ('الجولات السياحية', 'include', 3),
  ('الطيران الداخلي', 'include', 4),
  ('شريحة اتصال وباقة إنترنت', 'include', 5),
  ('خدمة عملاء 24 ساعة بالعربي', 'include', 6),
  ('وجبة الغداء والعشاء', 'exclude', 0),
  ('رسوم تذاكر دخول الأماكن السياحية', 'exclude', 1)
) as v(label, kind, sort) where o.serial = 'AD-1-1057-20260624';

insert into public.offer_terms (offer_id, text, sort)
select o.id, v.text, v.sort from public.offers o, (values
  ('البرنامج قابل للتعديل حسب رغبات العميل قبل التأكيد.', 0),
  ('جميع الحجوزات تخضع لتوفر الفنادق والغرف وقت التثبيت.', 1),
  ('أسعار الفنادق والطيران قابلة للتغيير حتى اعتماد البرنامج.', 2),
  ('الجولات السياحية داخل نطاق المدينة ولا تشمل تذاكر الدخول.', 3)
) as v(text, sort) where o.serial = 'AD-1-1057-20260624';

insert into public.pricings (offer_id, total, currency)
select id, 7368.19, 'ريال سعودي' from public.offers where serial = 'AD-1-1057-20260624';

insert into public.offer_revisions (offer_id, revision, note)
select id, 1, 'seed import' from public.offers where serial = 'AD-1-1057-20260624';

-- Auth user for the Admin employee. Login: admin@admin.com / Traveliun#2026
do $$
declare admin_id uuid := '11111111-1111-1111-1111-111111111111';
begin
  if not exists (select 1 from auth.users where email = 'admin@admin.com') then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', admin_id, 'authenticated', 'authenticated', 'admin@admin.com', crypt('Traveliun#2026', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), admin_id, admin_id::text, jsonb_build_object('sub', admin_id::text, 'email', 'admin@admin.com'), 'email', now(), now(), now());
  end if;
  update public.employees set auth_user_id = (select id from auth.users where email = 'admin@admin.com') where email = 'admin@admin.com';
end $$;



-- ═══════════════ 0003_lookups.sql ═══════════════

-- App Travluin — lookup tables for the remaining sidebar routes.
-- Mirrors the new interfaces in src/lib/types.ts. Run after 0001/0002.

create table if not exists public.airports (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  code text,
  country_id uuid references public.countries (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ports (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  country_id uuid references public.countries (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  mobile text,
  country_id uuid references public.countries (id) on delete set null,
  car_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  country_id uuid references public.countries (id) on delete set null,
  price numeric(12, 2),
  currency text,
  created_at timestamptz not null default now()
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  from_city text,
  to_city text,
  car_type text,
  price numeric(12, 2),
  currency text,
  country_id uuid references public.countries (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.statuses (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  group_name text,
  color text,
  created_at timestamptz not null default now()
);

create table if not exists public.supervisors (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.guide_informations (
  id uuid primary key default gen_random_uuid(),
  category text,
  title text not null,
  body text,
  created_at timestamptz not null default now()
);

create table if not exists public.profits (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  percent numeric(6, 2),
  country_id uuid references public.countries (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ready_offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  country text,
  days int,
  price numeric(12, 2),
  currency text,
  created_at timestamptz not null default now()
);

create table if not exists public.care_tickets (
  id uuid primary key default gen_random_uuid(),
  customer text,
  subject text,
  status text default 'Active',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists airports_country_id_idx on public.airports (country_id);
create index if not exists ports_country_id_idx on public.ports (country_id);
create index if not exists drivers_country_id_idx on public.drivers (country_id);
create index if not exists tours_country_id_idx on public.tours (country_id);
create index if not exists transfers_country_id_idx on public.transfers (country_id);
create index if not exists profits_country_id_idx on public.profits (country_id);

-- RLS: internal tables — authenticated employees have full access.
do $$
declare
  t text;
  tables text[] := array[
    'airports','ports','drivers','tours','transfers','statuses','supervisors',
    'guide_informations','profits','ready_offers','care_tickets'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists authenticated_all on public.%I;', t);
    execute format(
      'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;


-- ═══════════════ 0004_offer_pipeline.sql ═══════════════

-- App Travluin — offer pipeline: kanban stage + lock internal pricing + sample offers.

-- 1) Kanban stage (free-form pipeline column, separate from the status enum).
alter table public.offers add column if not exists pipeline_stage text not null default 'active_not_confirmed';

-- 2) SECURITY: pricings holds buy_total / profit — must never be readable by anon
--    (client offer links use the anon key). Revoke the public read policy.
drop policy if exists public_read on public.pricings;

-- 3) Sample offers so the kanban / hub / generator show real data.
--    Buy price & profit live in pricings (server-only), never in client output.
do $$
declare
  admin_id uuid := (select id from public.employees where english_name = 'Admin' limit 1);
  rec record;
  new_id uuid;
begin
  for rec in
    select * from (values
      ('AD-2-1057-20260626', 'تايلند',     '2026-06-26', 18087.54, 2359.24, 'sent',      'followed_up'),
      ('AD-3-7734-20260707', 'تركيا',      '2026-07-07', 11204.75,  634.23, 'draft',     'active_not_confirmed'),
      ('AD-1-6746-20251106', 'إندونيسيا',  '2025-11-06',  1380.00,  180.00, 'cancelled', 'active_not_confirmed'),
      ('AD-1-5211-20260701', 'ماليزيا',    '2026-07-01',  8419.46, 1000.00, 'confirmed', 'confirmed_hotels'),
      ('MY-2-8821-20260511', 'ماليزيا',    '2026-05-11',  8120.00,  760.00, 'sent',      'flights'),
      ('TR-5-1180-20260403', 'تركيا',      '2026-04-03',  5980.00,  540.00, 'draft',     'transportation'),
      ('TH-4-3400-20260218', 'تايلند',     '2026-02-18', 10450.00,  980.00, 'confirmed', 'completed')
    ) as t(serial, destination, offer_date, sell, profit, status, stage)
  loop
    if not exists (select 1 from public.offers where serial = rec.serial) then
      insert into public.offers (serial, employee_id, destination, offer_date, adults, total, currency, status, pipeline_stage)
      values (rec.serial, admin_id, rec.destination, rec.offer_date::date, 2, rec.sell, 'SAR', rec.status::public.offer_status, rec.stage)
      returning id into new_id;

      insert into public.pricings (offer_id, total, currency, buy_total, sell_total, profit)
      values (new_id, rec.sell, 'SAR', rec.sell - rec.profit, rec.sell, rec.profit);
    end if;
  end loop;

  -- set the pre-existing seeded offer onto a sensible stage
  update public.offers set pipeline_stage = 'confirmed_hotels'
  where serial = 'AD-1-1057-20260624' and pipeline_stage = 'active_not_confirmed';
end $$;


-- ═══════════════ 0005_guide_storage.sql ═══════════════

-- App Travluin — public Storage bucket for guide PDFs.
insert into storage.buckets (id, name, public)
values ('guide', 'guide', true)
on conflict (id) do nothing;

-- Anyone may read guide files (they are public download links).
drop policy if exists "guide public read" on storage.objects;
create policy "guide public read" on storage.objects
  for select to public using (bucket_id = 'guide');

-- Authenticated employees may upload / replace / remove guide files.
drop policy if exists "guide authenticated manage" on storage.objects;
create policy "guide authenticated manage" on storage.objects
  for all to authenticated using (bucket_id = 'guide') with check (bucket_id = 'guide');


-- ═══════════════ 0006_metrics_presence.sql ═══════════════

-- App Travluin — dashboard metrics foundation:
-- (1) turn care_tickets into a real "requests" model (assigned employee, type, responded),
-- (2) live presence table for online-now / active-today,
-- (3) seed demonstrable request + presence data.

-- 1) requests model
alter table public.care_tickets add column if not exists employee_id uuid references public.employees(id) on delete set null;
alter table public.care_tickets add column if not exists type text;
alter table public.care_tickets add column if not exists responded_at timestamptz;
create index if not exists care_tickets_employee_id_idx on public.care_tickets (employee_id);
create index if not exists care_tickets_created_at_idx on public.care_tickets (created_at);

-- 2) live presence (updated by the app heartbeat). Keyed by employee so the
--    admin view can attribute online users to employees.
create table if not exists public.presence (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  last_seen_at timestamptz not null default now()
);
alter table public.presence enable row level security;
drop policy if exists authenticated_all on public.presence;
create policy authenticated_all on public.presence for all to authenticated using (true) with check (true);

-- 3) seed requests across employees (types / answered / pending / today vs older)
do $$
declare
  admin_id uuid := (select id from public.employees where english_name = 'Admin' limit 1);
  emp2 uuid := (select id from public.employees where english_name = 'abd alrazaq' limit 1);
  emp3 uuid := (select id from public.employees where english_name = 'ahmed yousif' limit 1);
begin
  if not exists (select 1 from public.care_tickets where type is not null) then
    insert into public.care_tickets (customer, subject, status, type, employee_id, responded_at, created_at) values
      ('نايف الجهني', 'استفسار عن باقة ماليزيا', 'answered', 'استفسار', admin_id, now(), now()),
      ('سارة القحطاني', 'تعديل موعد الرحلة', 'pending', 'تعديل', admin_id, null, now()),
      ('الأستاذة هند', 'تعديل عدد المسافرين', 'answered', 'تعديل', admin_id, now(), now()),
      ('بدر حسين', 'استفسار عن الأسعار', 'pending', 'استفسار', admin_id, null, now() - interval '3 day'),
      ('عبدالله', 'حجز فندق إضافي', 'answered', 'حجز', emp2, now(), now() - interval '1 day'),
      ('رهف', 'شكوى بخصوص التوصيل', 'pending', 'شكوى', emp2, null, now()),
      ('رؤى الردادي', 'حجز جولة سياحية', 'pending', 'حجز', emp2, null, now()),
      ('خالد', 'استفسار عن التأشيرة', 'answered', 'استفسار', emp3, now(), now() - interval '2 day'),
      ('أمجد الشهري', 'تعديل مسار الرحلة', 'pending', 'تعديل', emp3, null, now()),
      ('أم يوسف', 'استفسار عن الفعاليات', 'answered', 'استفسار', emp3, now(), now());
  end if;
end $$;

-- seed a couple of "currently online" employees (fresh last_seen). The app
-- heartbeat keeps the signed-in user's row fresh; these age out naturally.
insert into public.presence (employee_id, last_seen_at)
select id, now() from public.employees where english_name in ('abd alrazaq', 'ahmed yousif')
on conflict (employee_id) do update set last_seen_at = now();


-- ═══════════════ 0007_lookup_seed.sql ═══════════════

-- App Travluin — realistic Arabic seed for the lookup tables created in 0003.
-- Each block inserts only if its table is still empty (safe to re-run).

insert into public.airports (arabic_name, english_name, code, country_id)
select v.a, v.e, v.c, (select id from public.countries where english_name = v.cty limit 1)
from (values
  ('مطار الملك خالد الدولي', 'King Khalid International', 'RUH', 'Saudi Arabia'),
  ('مطار الملك عبدالعزيز الدولي', 'King Abdulaziz International', 'JED', 'Saudi Arabia'),
  ('مطار كوالالمبور الدولي', 'Kuala Lumpur International', 'KUL', 'MALASYIA'),
  ('مطار لنكاوي الدولي', 'Langkawi International', 'LGK', 'MALASYIA'),
  ('مطار إسطنبول', 'Istanbul Airport', 'IST', 'Turkiye'),
  ('مطار سوكارنو هاتا', 'Soekarno-Hatta International', 'CGK', 'Indonesia'),
  ('مطار سوفارنابومي', 'Suvarnabhumi', 'BKK', 'Thailand')
) as v(a, e, c, cty)
where not exists (select 1 from public.airports);

insert into public.ports (arabic_name, english_name, country_id)
select v.a, v.e, (select id from public.countries where english_name = v.cty limit 1)
from (values
  ('ميناء بورت كلانج', 'Port Klang', 'MALASYIA'),
  ('ميناء إسطنبول', 'Istanbul Port', 'Turkiye'),
  ('ميناء تانجونج بريوك', 'Tanjung Priok', 'Indonesia')
) as v(a, e, cty)
where not exists (select 1 from public.ports);

insert into public.drivers (arabic_name, english_name, mobile, car_type, country_id)
select v.a, v.e, v.m, v.ct, (select id from public.countries where english_name = v.cty limit 1)
from (values
  ('عبدالله السائق', 'Abdullah', '0555111222', 'سيدان', 'MALASYIA'),
  ('محمد علي', 'Mohammed Ali', '0555333444', 'فان 7 ركاب', 'Turkiye'),
  ('سمير', 'Samir', '0555555666', 'سيدان', 'Thailand'),
  ('راجيش', 'Rajesh', '0555777888', 'فان', 'Indonesia')
) as v(a, e, m, ct, cty)
where not exists (select 1 from public.drivers);

insert into public.tours (arabic_name, english_name, country_id, price, currency)
select v.a, v.e, (select id from public.countries where english_name = v.cty limit 1), v.p, 'SAR'
from (values
  ('جولة البرجين التوأمين', 'Twin Towers Tour', 'MALASYIA', 180),
  ('جولة جنتنج هايلاند', 'Genting Highlands Tour', 'MALASYIA', 350),
  ('جولة البسفور', 'Bosphorus Cruise', 'Turkiye', 260),
  ('جولة مدينة بانكوك', 'Bangkok City Tour', 'Thailand', 200),
  ('جولة بالي الجنوبية', 'South Bali Tour', 'Indonesia', 240)
) as v(a, e, cty, p)
where not exists (select 1 from public.tours);

insert into public.transfers (from_city, to_city, car_type, price, currency, country_id)
select v.f, v.t, v.ct, v.p, 'SAR', (select id from public.countries where english_name = v.cty limit 1)
from (values
  ('كوالالمبور', 'لنكاوي', 'سيدان', 220, 'MALASYIA'),
  ('المطار', 'الفندق', 'فان', 120, 'MALASYIA'),
  ('إسطنبول', 'طرابزون', 'سيدان', 900, 'Turkiye'),
  ('المطار', 'الفندق', 'سيدان', 150, 'Thailand')
) as v(f, t, ct, p, cty)
where not exists (select 1 from public.transfers);

insert into public.statuses (arabic_name, english_name, group_name, color)
select v.a, v.e, v.g, v.c
from (values
  ('فعال', 'Active', 'الحالات العامة', '#2aa87a'),
  ('غير مؤكد', 'Not Confirmed', 'حالات العروض', '#d99a00'),
  ('مؤكد', 'Confirmed', 'حالات العروض', '#0f7a52'),
  ('ملغي', 'Cancelled', 'حالات العروض', '#be123c'),
  ('مكتمل', 'Completed', 'حالات العروض', '#185045')
) as v(a, e, g, c)
where not exists (select 1 from public.statuses);

insert into public.supervisors (arabic_name, english_name, email)
select v.a, v.e, v.m
from (values
  ('أحمد المشرف', 'Ahmed', 'ahmed.sup@traveliun.com'),
  ('سارة', 'Sara', 'sara.sup@traveliun.com'),
  ('خالد', 'Khaled', 'khaled.sup@traveliun.com')
) as v(a, e, m)
where not exists (select 1 from public.supervisors);

insert into public.guide_informations (category, title, body)
select v.c, v.t, v.b
from (values
  ('فن البيع', 'أساسيات إغلاق الصفقة', 'تعامل مع اعتراضات العميل بثقة، وأبرز القيمة قبل السعر، واختم بخطوة واضحة للحجز.'),
  ('تركيا', 'أهم الأماكن السياحية في إسطنبول', 'آيا صوفيا، السلطان أحمد، البسفور، تقسيم، والجزر الأميرية.'),
  ('ماليزيا', 'جولات كوالالمبور', 'البرجان التوأم، منارة كوالالمبور، جنتنج هايلاند، وباتو كيفز.'),
  ('الإدارة المالية', 'قواعد متابعة الموردين', 'طابق الحسابات أسبوعياً، ووثّق كل تحويل، وراجع تفضيلات الموردين قبل التثبيت.')
) as v(c, t, b)
where not exists (select 1 from public.guide_informations);

insert into public.profits (arabic_name, percent, country_id)
select v.a, v.p, (select id from public.countries where english_name = v.cty limit 1)
from (values
  ('هامش ماليزيا', 15, 'MALASYIA'),
  ('هامش تركيا', 18, 'Turkiye'),
  ('هامش تايلاند', 20, 'Thailand'),
  ('الهامش الافتراضي', 12, '')
) as v(a, p, cty)
where not exists (select 1 from public.profits);

insert into public.ready_offers (title, country, days, price, currency)
select v.t, v.c, v.d, v.p, 'SAR'
from (values
  ('ماليزيا العائلية', 'ماليزيا', 8, 7368),
  ('تركيا الاقتصادية', 'تركيا', 6, 5980),
  ('تايلاند شهر العسل', 'تايلاند', 7, 8500),
  ('بالي الرومانسية', 'إندونيسيا', 6, 9200)
) as v(t, c, d, p)
where not exists (select 1 from public.ready_offers);

insert into public.care_tickets (customer, subject, status, note)
select v.c, v.s, v.st, v.n
from (values
  ('نايف الجهني', 'استفسار عن موعد الرحلة', 'Active', 'تم التواصل عبر الواتساب.'),
  ('سارة القحطاني', 'طلب تعديل الفندق', 'Active', 'بانتظار رد الفندق على التوفر.'),
  ('أحمد', 'شكوى تأخير الرد', 'Completed', 'تم الحل وتقديم اعتذار للعميل.')
) as v(c, s, st, n)
where not exists (select 1 from public.care_tickets);


-- ═══════════════ 0008_package_generator.sql ═══════════════

-- App Travluin — package-generator data layer.
-- Adds: dual-priced hotel lines (offer_hotels), richer flight legs, a per-item
-- pricing rollup (offer_pricing_items), immutable render snapshots (offer_renders),
-- and manual monthly city climate notes (city_climate_notes).
-- Idempotent; safe to re-run. Extends the existing schema (0001..0007).
--
-- SECURITY MODEL (unchanged principle): buy_price / profit must NEVER be readable
-- by anon (public /client-offer links use the anon key). Therefore:
--   * offer_hotels, offer_pricing_items, offer_renders  -> authenticated only.
--   * offer_flights STAYS anon-readable, so it carries NO buy pricing — flight
--     buy/sell live in offer_pricing_items (item_type='flight') instead.
--   * city_climate_notes carries no pricing and is shown to clients -> anon read.

-- ---------- room_types: hotel scope + capacity + default board ----------
alter table public.room_types add column if not exists hotel_id uuid references public.hotels (id) on delete cascade;
alter table public.room_types add column if not exists capacity int;
alter table public.room_types add column if not exists default_board text;
create index if not exists room_types_hotel_id_idx on public.room_types (hotel_id);

-- ---------- offer_cities: trip-planning columns ----------
-- Already present as check_in / check_out / nights / sort (0001_init.sql), which
-- cover the requested check_in_date / check_out_date / nights_count / sort_order.
-- No change needed.

-- ---------- offer_hotels (NEW): normalized hotel lines with dual pricing ----------
create table if not exists public.offer_hotels (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  offer_city_id uuid references public.offer_cities (id) on delete cascade,
  hotel_id uuid references public.hotels (id) on delete set null,
  hotel_name text,
  room_type_id uuid references public.room_types (id) on delete set null,
  rooms_count int not null default 1,
  board_type text check (board_type in ('RO', 'BB', 'HB', 'FB', 'AI')),
  check_in date,
  check_out date,
  nights int,
  buy_price numeric(12, 2),
  buy_currency text,
  sell_price numeric(12, 2),
  sell_currency text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists offer_hotels_offer_id_idx on public.offer_hotels (offer_id);
create index if not exists offer_hotels_offer_city_id_idx on public.offer_hotels (offer_city_id);

-- ---------- offer_flights: richer leg + schedule fields (client-safe; NO buy pricing) ----------
alter table public.offer_flights add column if not exists airline text;        -- alias display; carrier stays the canonical column
alter table public.offer_flights add column if not exists flight_no text;
alter table public.offer_flights add column if not exists departure_at timestamptz;
alter table public.offer_flights add column if not exists arrival_at timestamptz;
alter table public.offer_flights add column if not exists cabin_class text;      -- alias of cabin
alter table public.offer_flights add column if not exists baggage_allowance text; -- alias of baggage
alter table public.offer_flights add column if not exists leg_order text;
do $$ begin
  alter table public.offer_flights
    add constraint offer_flights_leg_order_chk check (leg_order in ('outbound', 'inbound', 'internal'));
exception when duplicate_object then null; end $$;

-- ---------- offer_pricing_items (NEW): unified per-item buy/sell rollup (server-only) ----------
create table if not exists public.offer_pricing_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  item_type text not null check (item_type in ('hotel', 'flight', 'visa', 'service', 'transport', 'other')),
  item_id uuid,
  description text,
  quantity numeric(12, 2) not null default 1,
  buy_price numeric(12, 2),
  buy_currency text,
  sell_price numeric(12, 2),
  sell_currency text,
  total_buy numeric(12, 2),
  total_sell numeric(12, 2),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists offer_pricing_items_offer_id_idx on public.offer_pricing_items (offer_id);

-- ---------- offer_renders (NEW): immutable snapshot of what was actually sent ----------
create table if not exists public.offer_renders (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  version int not null default 1,
  variant text not null check (variant in ('client', 'internal')),
  snapshot_json jsonb not null default '{}'::jsonb,
  file_path text,
  rendered_by uuid references public.employees (id) on delete set null,
  rendered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists offer_renders_offer_id_idx on public.offer_renders (offer_id);

-- ---------- city_climate_notes (NEW): manual monthly climate advice ----------
-- NOT a weather API — forecasts can't cover trips months out, so these are
-- editorially maintained per city + month.
create table if not exists public.city_climate_notes (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities (id) on delete cascade,
  month int not null check (month between 1 and 12),
  avg_high_c numeric(4, 1),
  avg_low_c numeric(4, 1),
  rain_level text check (rain_level in ('low', 'medium', 'high')),
  humidity_level text check (humidity_level in ('low', 'medium', 'high')),
  advice_ar text,
  advice_en text,
  updated_by uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (city_id, month)
);
create index if not exists city_climate_notes_city_id_idx on public.city_climate_notes (city_id);

-- ---------- indexes for pricing item soft-refs ----------
create index if not exists offer_pricing_items_item_idx on public.offer_pricing_items (item_type, item_id);

-- ---------- row-level security ----------
do $$
declare
  t text;
  authed_tables text[] := array[
    'offer_hotels', 'offer_pricing_items', 'offer_renders', 'city_climate_notes'
  ];
begin
  foreach t in array authed_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists authenticated_all on public.%I;', t);
    execute format(
      'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true);', t);
  end loop;

  -- Climate advice is client-facing (shown in the offer preview/PDF) and carries
  -- no pricing, so anon may READ it. The pricing/hotel/render tables get NO anon
  -- policy on purpose — they hold buy_price / profit.
  drop policy if exists public_read on public.city_climate_notes;
  create policy public_read on public.city_climate_notes for select to anon using (true);
end $$;


-- ═══════════════ 0009_offer_drafts.sql ═══════════════

-- App Travluin — package-generator drafts.
-- One row per in-progress offer draft. Each stage of /package-generator/[draftId]/*
-- auto-saves its slice into `data` (jsonb), so work is resumable from any URL.
-- Internal-only: drafts can contain buy pricing → NO anon policy, ever.
-- Idempotent; safe to re-run.

create table if not exists public.offer_drafts (
  id uuid primary key default gen_random_uuid(),
  title text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.employees (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists offer_drafts_updated_at_idx on public.offer_drafts (updated_at desc);

alter table public.offer_drafts enable row level security;
drop policy if exists authenticated_all on public.offer_drafts;
create policy authenticated_all on public.offer_drafts
  for all to authenticated using (true) with check (true);


-- ═══════════════ 0010_offer_publish.sql ═══════════════

-- App Travluin — offer publishing + versioned client renders.
-- Adds an audit trail of offer status changes, lets the PUBLIC client link read
-- the published (already-redacted) client snapshot, and guards render versions.
-- Idempotent; safe to re-run.

-- ---------- offer_status_history (NEW): audit trail of status transitions ----------
create table if not exists public.offer_status_history (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists offer_status_history_offer_id_idx on public.offer_status_history (offer_id);

-- One row per (offer, variant, version) — publishing computes the next version.
create unique index if not exists offer_renders_offer_variant_version_uidx
  on public.offer_renders (offer_id, variant, version);

-- ---------- row-level security ----------
do $$ begin
  -- audit trail: authenticated only.
  execute 'alter table public.offer_status_history enable row level security';
  execute 'drop policy if exists authenticated_all on public.offer_status_history';
  execute 'create policy authenticated_all on public.offer_status_history for all to authenticated using (true) with check (true)';

  -- The PUBLIC /client-offer link (anon key) must serve the LATEST PUBLISHED
  -- client snapshot. offer_renders is otherwise authenticated-only; grant anon
  -- SELECT for variant='client' ONLY. Client snapshots are the ClientOfferDTO,
  -- which is structurally stripped of buy_price / profit / margin (dto.ts), so
  -- this exposes nothing an offer's own serial-holder can't already see.
  -- Internal renders stay hidden from anon.
  execute 'drop policy if exists public_read_client on public.offer_renders';
  execute 'create policy public_read_client on public.offer_renders for select to anon using (variant = ''client'')';
end $$;


-- ═══════════════ 0011_reference_data.sql ═══════════════

-- App Travluin — reference data the package generator needs (schema).
-- Extends countries + airports and adds transportation_types. Idempotent.
-- Seeds live in 0012_reference_seed.sql. Naming keeps the existing convention
-- (arabic_name/english_name) and maps the requested fields onto it:
--   name_ar -> arabic_name, name_en -> english_name, default_currency -> default_currency,
--   status -> status. New columns are added for the rest.

-- ---------- countries: iso2 + timezone + visa flag ----------
alter table public.countries add column if not exists iso2 text;
alter table public.countries add column if not exists timezone text;              -- primary IANA tz
alter table public.countries add column if not exists visa_required boolean;       -- general destination flag
-- iso2 is the stable join key for airports; unique but nullable (many NULLs allowed).
create unique index if not exists countries_iso2_uidx on public.countries (iso2) where iso2 is not null;

-- ---------- airports: full flight-engine shape (code = IATA) ----------
alter table public.airports add column if not exists icao text;
alter table public.airports add column if not exists city_id uuid references public.cities (id) on delete set null;
alter table public.airports add column if not exists iana_timezone text;           -- REQUIRED by the flight engine
alter table public.airports add column if not exists lat numeric(9, 6);
alter table public.airports add column if not exists lng numeric(9, 6);
alter table public.airports add column if not exists status text not null default 'Active';
create index if not exists airports_city_id_idx on public.airports (city_id);
create index if not exists airports_code_idx on public.airports (code);

-- ---------- transportation_types (NEW): admin-editable catalog with dual pricing ----------
create table if not exists public.transportation_types (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  category text,                         -- e.g. transfer / disposal / tour / rental / special
  vehicle_class text,                    -- e.g. sedan / suv / van / minibus / bus / limo / boat / train …
  pax_capacity int,
  luggage_capacity int,
  with_driver boolean not null default true,
  duration_unit text check (duration_unit in ('trip', 'hour', 'day')),
  buy_price numeric(12, 2),
  buy_currency text,
  sell_price numeric(12, 2),
  sell_currency text,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

-- ---------- row-level security (internal — authenticated employees) ----------
do $$ begin
  execute 'alter table public.transportation_types enable row level security';
  execute 'drop policy if exists authenticated_all on public.transportation_types';
  execute 'create policy authenticated_all on public.transportation_types for all to authenticated using (true) with check (true)';
end $$;


-- ═══════════════ 0012_reference_seed.sql ═══════════════

-- App Travluin — reference-data seed (countries, airports, transportation types).
-- Idempotent: existing rows are backfilled; new rows insert only when absent
-- (countries keyed by iso2, airports by IATA code, transport types by english_name).
-- Every IATA code + IANA timezone below was verified against the provided list.

-- ============================ COUNTRIES ============================
-- 1) Backfill the 10 pre-seeded countries with iso2 / timezone / currency / visa flag.
update public.countries set iso2='MY', timezone='Asia/Kuala_Lumpur', default_currency='MYR', visa_required=false where iso2 is null and (arabic_name='ماليزيا' or english_name='MALASYIA');
update public.countries set iso2='ID', timezone='Asia/Jakarta', default_currency='IDR', visa_required=false where iso2 is null and (arabic_name='اندونيسيا' or english_name='Indonesia');
update public.countries set iso2='FR', timezone='Europe/Paris', default_currency='EUR', visa_required=true where iso2 is null and (arabic_name='فرنسا' or english_name='Fransa');
update public.countries set iso2='TR', timezone='Europe/Istanbul', default_currency='TRY', visa_required=false where iso2 is null and (arabic_name='تركيا' or english_name='Turkiye');
update public.countries set iso2='RU', timezone='Europe/Moscow', default_currency='RUB', visa_required=true where iso2 is null and (arabic_name='روسيا' or english_name='russia');
update public.countries set iso2='TH', timezone='Asia/Bangkok', default_currency='THB', visa_required=false where iso2 is null and (arabic_name='تايلاند' or english_name='Thailand');
update public.countries set iso2='CH', timezone='Europe/Zurich', default_currency='CHF', visa_required=true where iso2 is null and (arabic_name='سويسرا' or english_name='Switzerland');
update public.countries set iso2='SA', timezone='Asia/Riyadh', default_currency='SAR', visa_required=false where iso2 is null and (arabic_name='السعوديه' or english_name='Saudi Arabia');
update public.countries set iso2='KR', timezone='Asia/Seoul', default_currency='KRW', visa_required=true where iso2 is null and (arabic_name='كوريا الجنوبية' or english_name='South Korea');
update public.countries set iso2='MA', timezone='Africa/Casablanca', default_currency='MAD', visa_required=false where iso2 is null and (arabic_name='المغرب' or english_name='Morocco');

-- 2) Insert the full destination set (skips any iso2 already present).
insert into public.countries (arabic_name, english_name, iso2, default_currency, timezone, visa_required, status)
select v.ar, v.en, v.iso2, v.cur, v.tz, v.visa, 'Active'
from (values
  -- GCC
  ('السعودية','Saudi Arabia','SA','SAR','Asia/Riyadh',false),
  ('الإمارات العربية المتحدة','United Arab Emirates','AE','AED','Asia/Dubai',false),
  ('عُمان','Oman','OM','OMR','Asia/Muscat',false),
  ('قطر','Qatar','QA','QAR','Asia/Qatar',false),
  ('الكويت','Kuwait','KW','KWD','Asia/Kuwait',false),
  ('البحرين','Bahrain','BH','BHD','Asia/Bahrain',false),
  -- Asia
  ('تايلاند','Thailand','TH','THB','Asia/Bangkok',false),
  ('ماليزيا','Malaysia','MY','MYR','Asia/Kuala_Lumpur',false),
  ('إندونيسيا','Indonesia','ID','IDR','Asia/Jakarta',false),
  ('سنغافورة','Singapore','SG','SGD','Asia/Singapore',false),
  ('فيتنام','Vietnam','VN','VND','Asia/Ho_Chi_Minh',true),
  ('الفلبين','Philippines','PH','PHP','Asia/Manila',true),
  ('اليابان','Japan','JP','JPY','Asia/Tokyo',true),
  ('كوريا الجنوبية','South Korea','KR','KRW','Asia/Seoul',true),
  ('الصين','China','CN','CNY','Asia/Shanghai',true),
  ('هونغ كونغ','Hong Kong','HK','HKD','Asia/Hong_Kong',false),
  ('المالديف','Maldives','MV','MVR','Indian/Maldives',false),
  ('سريلانكا','Sri Lanka','LK','LKR','Asia/Colombo',true),
  ('نيبال','Nepal','NP','NPR','Asia/Kathmandu',false),
  ('الهند','India','IN','INR','Asia/Kolkata',true),
  -- Europe
  ('تركيا','Turkey','TR','TRY','Europe/Istanbul',false),
  ('جورجيا','Georgia','GE','GEL','Asia/Tbilisi',false),
  ('أذربيجان','Azerbaijan','AZ','AZN','Asia/Baku',true),
  ('أرمينيا','Armenia','AM','AMD','Asia/Yerevan',false),
  ('البوسنة والهرسك','Bosnia and Herzegovina','BA','BAM','Europe/Sarajevo',false),
  ('ألبانيا','Albania','AL','ALL','Europe/Tirane',false),
  ('صربيا','Serbia','RS','RSD','Europe/Belgrade',false),
  ('اليونان','Greece','GR','EUR','Europe/Athens',true),
  ('إيطاليا','Italy','IT','EUR','Europe/Rome',true),
  ('فرنسا','France','FR','EUR','Europe/Paris',true),
  ('إسبانيا','Spain','ES','EUR','Europe/Madrid',true),
  ('سويسرا','Switzerland','CH','CHF','Europe/Zurich',true),
  ('النمسا','Austria','AT','EUR','Europe/Vienna',true),
  ('ألمانيا','Germany','DE','EUR','Europe/Berlin',true),
  ('هولندا','Netherlands','NL','EUR','Europe/Amsterdam',true),
  ('المملكة المتحدة','United Kingdom','GB','GBP','Europe/London',true),
  ('التشيك','Czechia','CZ','CZK','Europe/Prague',true),
  ('المجر','Hungary','HU','HUF','Europe/Budapest',true),
  ('البرتغال','Portugal','PT','EUR','Europe/Lisbon',true),
  ('روسيا','Russia','RU','RUB','Europe/Moscow',true),
  -- Africa
  ('مصر','Egypt','EG','EGP','Africa/Cairo',false),
  ('المغرب','Morocco','MA','MAD','Africa/Casablanca',false),
  ('تونس','Tunisia','TN','TND','Africa/Tunis',false),
  ('كينيا','Kenya','KE','KES','Africa/Nairobi',true),
  ('تنزانيا','Tanzania','TZ','TZS','Africa/Dar_es_Salaam',true),
  ('موريشيوس','Mauritius','MU','MUR','Indian/Mauritius',false),
  ('سيشل','Seychelles','SC','SCR','Indian/Mahe',false),
  -- Also
  ('الأردن','Jordan','JO','JOD','Asia/Amman',false),
  ('لبنان','Lebanon','LB','LBP','Asia/Beirut',false),
  ('قبرص','Cyprus','CY','EUR','Asia/Nicosia',true),
  ('كازاخستان','Kazakhstan','KZ','KZT','Asia/Almaty',false),
  ('أوزبكستان','Uzbekistan','UZ','UZS','Asia/Tashkent',false),
  ('الولايات المتحدة','United States','US','USD','America/New_York',true),
  ('كندا','Canada','CA','CAD','America/Toronto',true),
  ('أستراليا','Australia','AU','AUD','Australia/Sydney',true)
) as v(ar, en, iso2, cur, tz, visa)
where not exists (select 1 from public.countries c where c.iso2 = v.iso2);

-- ============================ AIRPORTS ============================
-- 1) Backfill IANA timezone on the 7 pre-seeded airports.
update public.airports set iana_timezone='Asia/Riyadh'        where code='RUH' and iana_timezone is null;
update public.airports set iana_timezone='Asia/Riyadh'        where code='JED' and iana_timezone is null;
update public.airports set iana_timezone='Asia/Kuala_Lumpur'  where code='KUL' and iana_timezone is null;
update public.airports set iana_timezone='Asia/Kuala_Lumpur'  where code='LGK' and iana_timezone is null;
update public.airports set iana_timezone='Europe/Istanbul'    where code='IST' and iana_timezone is null;
update public.airports set iana_timezone='Asia/Jakarta'       where code='CGK' and iana_timezone is null;
update public.airports set iana_timezone='Asia/Bangkok'       where code='BKK' and iana_timezone is null;

-- 2) Insert the full airport set (skips any IATA code already present).
insert into public.airports (arabic_name, english_name, code, iana_timezone, country_id, status)
select v.ar, v.en, v.iata, v.tz, (select id from public.countries where iso2 = v.iso2 limit 1), 'Active'
from (values
  -- Saudi Arabia (Asia/Riyadh)
  ('مطار الملك خالد الدولي','King Khalid International','RUH','SA','Asia/Riyadh'),
  ('مطار الملك عبدالعزيز الدولي','King Abdulaziz International','JED','SA','Asia/Riyadh'),
  ('مطار الملك فهد الدولي','King Fahd International','DMM','SA','Asia/Riyadh'),
  ('مطار الأمير محمد بن عبدالعزيز','Prince Mohammad bin Abdulaziz','MED','SA','Asia/Riyadh'),
  ('مطار أبها الدولي','Abha International','AHB','SA','Asia/Riyadh'),
  ('مطار الطائف الدولي','Taif International','TIF','SA','Asia/Riyadh'),
  ('مطار ينبع','Yanbu','YNB','SA','Asia/Riyadh'),
  ('مطار القصيم','Qassim','ELQ','SA','Asia/Riyadh'),
  ('مطار حائل','Hail','HAS','SA','Asia/Riyadh'),
  ('مطار تبوك','Tabuk','TUU','SA','Asia/Riyadh'),
  ('مطار جازان','Jazan','GIZ','SA','Asia/Riyadh'),
  ('مطار نيوم باي','Neom Bay','NUM','SA','Asia/Riyadh'),
  -- UAE (Asia/Dubai)
  ('مطار دبي الدولي','Dubai International','DXB','AE','Asia/Dubai'),
  ('مطار آل مكتوم الدولي','Al Maktoum International','DWC','AE','Asia/Dubai'),
  ('مطار أبوظبي الدولي','Abu Dhabi International','AUH','AE','Asia/Dubai'),
  ('مطار الشارقة الدولي','Sharjah International','SHJ','AE','Asia/Dubai'),
  ('مطار رأس الخيمة الدولي','Ras Al Khaimah International','RKT','AE','Asia/Dubai'),
  ('مطار الفجيرة الدولي','Fujairah International','FJR','AE','Asia/Dubai'),
  ('مطار العين الدولي','Al Ain International','AAN','AE','Asia/Dubai'),
  -- Oman (Asia/Muscat)
  ('مطار مسقط الدولي','Muscat International','MCT','OM','Asia/Muscat'),
  ('مطار صلالة','Salalah','SLL','OM','Asia/Muscat'),
  ('مطار الدقم','Duqm','DQM','OM','Asia/Muscat'),
  ('مطار خصب','Khasab','KHS','OM','Asia/Muscat'),
  ('مطار صحار','Sohar','OHS','OM','Asia/Muscat'),
  -- Qatar / Kuwait / Bahrain
  ('مطار حمد الدولي','Hamad International','DOH','QA','Asia/Qatar'),
  ('مطار الكويت الدولي','Kuwait International','KWI','KW','Asia/Kuwait'),
  ('مطار البحرين الدولي','Bahrain International','BAH','BH','Asia/Bahrain'),
  -- Thailand (Asia/Bangkok)
  ('مطار سوفارنابومي','Suvarnabhumi','BKK','TH','Asia/Bangkok'),
  ('مطار دون موانج','Don Mueang','DMK','TH','Asia/Bangkok'),
  ('مطار بوكيت','Phuket','HKT','TH','Asia/Bangkok'),
  ('مطار شيانغ ماي','Chiang Mai','CNX','TH','Asia/Bangkok'),
  -- Malaysia (Asia/Kuala_Lumpur)
  ('مطار كوالالمبور الدولي','Kuala Lumpur International','KUL','MY','Asia/Kuala_Lumpur'),
  ('مطار لنكاوي الدولي','Langkawi International','LGK','MY','Asia/Kuala_Lumpur'),
  ('مطار بينانج الدولي','Penang International','PEN','MY','Asia/Kuala_Lumpur'),
  -- Indonesia
  ('مطار بالي نجوراه راي','Bali Ngurah Rai','DPS','ID','Asia/Makassar'),
  ('مطار سوكارنو هاتا','Soekarno-Hatta','CGK','ID','Asia/Jakarta'),
  -- Singapore / Vietnam / Philippines
  ('مطار شانغي','Changi','SIN','SG','Asia/Singapore'),
  ('مطار تان سون نات','Tan Son Nhat','SGN','VN','Asia/Ho_Chi_Minh'),
  ('مطار نوي باي','Noi Bai','HAN','VN','Asia/Ho_Chi_Minh'),
  ('مطار دا نانغ','Da Nang','DAD','VN','Asia/Ho_Chi_Minh'),
  ('مطار نينوي أكينو','Ninoy Aquino','MNL','PH','Asia/Manila'),
  -- Korea / Japan / Hong Kong / China
  ('مطار إنتشون الدولي','Incheon International','ICN','KR','Asia/Seoul'),
  ('مطار ناريتا','Narita','NRT','JP','Asia/Tokyo'),
  ('مطار هانيدا','Haneda','HND','JP','Asia/Tokyo'),
  ('مطار كانساي','Kansai','KIX','JP','Asia/Tokyo'),
  ('مطار هونغ كونغ الدولي','Hong Kong International','HKG','HK','Asia/Hong_Kong'),
  ('مطار شنغهاي بودونغ','Shanghai Pudong','PVG','CN','Asia/Shanghai'),
  ('مطار بكين الدولي','Beijing Capital','PEK','CN','Asia/Shanghai'),
  -- Maldives / Sri Lanka / Nepal / India
  ('مطار فيلانا الدولي','Velana International','MLE','MV','Indian/Maldives'),
  ('مطار باندارانايكه الدولي','Bandaranaike International','CMB','LK','Asia/Colombo'),
  ('مطار تريبوفان الدولي','Tribhuvan International','KTM','NP','Asia/Kathmandu'),
  ('مطار إنديرا غاندي الدولي','Indira Gandhi International','DEL','IN','Asia/Kolkata'),
  ('مطار شاتراباتي شيفاجي','Chhatrapati Shivaji','BOM','IN','Asia/Kolkata'),
  -- Turkey (Europe/Istanbul)
  ('مطار إسطنبول','Istanbul Airport','IST','TR','Europe/Istanbul'),
  ('مطار صبيحة كوكجن','Sabiha Gokcen','SAW','TR','Europe/Istanbul'),
  ('مطار أنطاليا','Antalya','AYT','TR','Europe/Istanbul'),
  ('مطار طرابزون','Trabzon','TZX','TR','Europe/Istanbul'),
  ('مطار بودروم ميلاس','Bodrum Milas','BJV','TR','Europe/Istanbul'),
  -- Caucasus
  ('مطار تبليسي الدولي','Tbilisi International','TBS','GE','Asia/Tbilisi'),
  ('مطار باتومي الدولي','Batumi International','BUS','GE','Asia/Tbilisi'),
  ('مطار حيدر علييف الدولي','Heydar Aliyev International','GYD','AZ','Asia/Baku'),
  ('مطار زفارتنوتس','Zvartnots','EVN','AM','Asia/Yerevan'),
  -- Balkans / Greece
  ('مطار سراييفو','Sarajevo','SJJ','BA','Europe/Sarajevo'),
  ('مطار تيرانا','Tirana','TIA','AL','Europe/Tirane'),
  ('مطار أثينا الدولي','Athens International','ATH','GR','Europe/Athens'),
  -- UK / France / Germany / Switzerland / Austria
  ('مطار هيثرو','Heathrow','LHR','GB','Europe/London'),
  ('مطار غاتويك','Gatwick','LGW','GB','Europe/London'),
  ('مطار شارل ديغول','Charles de Gaulle','CDG','FR','Europe/Paris'),
  ('مطار فرانكفورت','Frankfurt','FRA','DE','Europe/Berlin'),
  ('مطار ميونخ','Munich','MUC','DE','Europe/Berlin'),
  ('مطار زيورخ','Zurich','ZRH','CH','Europe/Zurich'),
  ('مطار جنيف','Geneva','GVA','CH','Europe/Zurich'),
  ('مطار فيينا','Vienna','VIE','AT','Europe/Vienna'),
  -- Italy / Spain / Netherlands
  ('مطار روما فيوميتشينو','Rome Fiumicino','FCO','IT','Europe/Rome'),
  ('مطار ميلانو مالبينسا','Milan Malpensa','MXP','IT','Europe/Rome'),
  ('مطار البندقية','Venice','VCE','IT','Europe/Rome'),
  ('مطار برشلونة','Barcelona','BCN','ES','Europe/Madrid'),
  ('مطار مدريد','Madrid','MAD','ES','Europe/Madrid'),
  ('مطار أمستردام سخيبول','Amsterdam Schiphol','AMS','NL','Europe/Amsterdam'),
  -- Czechia / Hungary / Portugal / Russia
  ('مطار براغ','Prague','PRG','CZ','Europe/Prague'),
  ('مطار بودابست','Budapest','BUD','HU','Europe/Budapest'),
  ('مطار لشبونة','Lisbon','LIS','PT','Europe/Lisbon'),
  ('مطار موسكو شيريميتيفو','Moscow Sheremetyevo','SVO','RU','Europe/Moscow'),
  -- Egypt / Morocco / Tunisia
  ('مطار القاهرة الدولي','Cairo International','CAI','EG','Africa/Cairo'),
  ('مطار شرم الشيخ الدولي','Sharm El Sheikh International','SSH','EG','Africa/Cairo'),
  ('مطار الغردقة الدولي','Hurghada International','HRG','EG','Africa/Cairo'),
  ('مطار الدار البيضاء محمد الخامس','Casablanca Mohammed V','CMN','MA','Africa/Casablanca'),
  ('مطار مراكش المنارة','Marrakesh Menara','RAK','MA','Africa/Casablanca'),
  ('مطار تونس قرطاج','Tunis Carthage','TUN','TN','Africa/Tunis'),
  -- East Africa / Islands
  ('مطار نيروبي جومو كينياتا','Nairobi Jomo Kenyatta','NBO','KE','Africa/Nairobi'),
  ('مطار زنجبار','Zanzibar','ZNZ','TZ','Africa/Dar_es_Salaam'),
  ('مطار موريشيوس','Mauritius SSR','MRU','MU','Indian/Mauritius'),
  ('مطار سيشل الدولي','Seychelles International','SEZ','SC','Indian/Mahe'),
  -- Americas / Oceania
  ('مطار نيويورك جون كينيدي','New York JFK','JFK','US','America/New_York'),
  ('مطار لوس أنجلوس','Los Angeles','LAX','US','America/Los_Angeles'),
  ('مطار تورنتو بيرسون','Toronto Pearson','YYZ','CA','America/Toronto'),
  ('مطار سيدني','Sydney','SYD','AU','Australia/Sydney')
) as v(ar, en, iata, iso2, tz)
where not exists (select 1 from public.airports a where a.code = v.iata);

-- ============================ TRANSPORTATION TYPES ============================
insert into public.transportation_types
  (arabic_name, english_name, category, vehicle_class, pax_capacity, luggage_capacity, with_driver, duration_unit, status)
select v.ar, v.en, v.cat, v.vc, v.pax, v.lug, v.wd, v.du, 'Active'
from (values
  ('استقبال من المطار (خاص)','Airport pickup (private)','transfer','sedan',3,3,true,'trip'),
  ('استقبال من المطار (مشترك)','Airport pickup (shared)','transfer','shuttle',10,10,true,'trip'),
  ('توديع إلى المطار','Airport drop-off','transfer','sedan',3,3,true,'trip'),
  ('توصيل ذهاب وعودة للمطار','Round-trip airport transfer','transfer','sedan',3,3,true,'trip'),
  ('تنقل بين المدن','Intercity transfer','transfer','van',6,6,true,'trip'),
  ('سيارة خاصة مع سائق - سيدان','Private car with driver — sedan','private','sedan',3,3,true,'day'),
  ('سيارة خاصة مع سائق - دفع رباعي','Private car with driver — SUV','private','suv',5,5,true,'day'),
  ('سيارة خاصة مع سائق - فان 7 ركاب','Private car with driver — van 7pax','private','van',7,7,true,'day'),
  ('سيارة خاصة مع سائق - ميني باص 14 راكب','Private car with driver — minibus 14pax','private','minibus',14,14,true,'day'),
  ('سيارة خاصة مع سائق - باص 30-50 راكب','Private car with driver — bus 30-50pax','private','bus',50,50,true,'day'),
  ('تأجير بالساعة 4 ساعات','Hourly disposal 4h','disposal','sedan',3,3,true,'hour'),
  ('تأجير بالساعة 8 ساعات','Hourly disposal 8h','disposal','sedan',3,3,true,'hour'),
  ('تأجير بالساعة 12 ساعة','Hourly disposal 12h','disposal','sedan',3,3,true,'hour'),
  ('سيارة جولة ليوم كامل مع سائق','Full-day tour vehicle with driver','tour','suv',5,5,true,'day'),
  ('تأجير سيارة ذاتية القيادة','Self-drive rental car','rental','sedan',5,4,false,'day'),
  ('ليموزين / VIP','Limousine / VIP','special','limousine',3,3,true,'trip'),
  ('استقبال ومساعدة + مسار سريع','Meet and greet + fast-track','special',NULL,NULL,NULL,true,'trip'),
  ('عبّارة / قارب سريع','Ferry / speedboat transfer','transfer','boat',10,10,true,'trip'),
  ('تذكرة قطار','Train ticket','ticket','train',1,1,false,'trip'),
  ('طائرة مروحية أو مائية','Helicopter or seaplane transfer','special','helicopter',4,2,true,'trip'),
  ('التلفريك','Cable car','ticket','cablecar',1,0,false,'trip'),
  ('بطاقة تنقل / مترو','City travel card / metro pass','ticket','metro',1,0,false,'day'),
  ('دراجة نارية / سكوتر','Motorbike / scooter','rental','scooter',1,1,false,'day'),
  ('مركبة مجهزة لذوي الاحتياجات','Wheelchair-accessible vehicle','special','van',4,4,true,'trip')
) as v(ar, en, cat, vc, pax, lug, wd, du)
where not exists (select 1 from public.transportation_types t where t.english_name = v.en);


-- ═══════════════ 0013_markup_rules.sql ═══════════════

-- App Travluin — markup rules catalog (admin-editable pricing rules).
-- The pricing engine (src/lib/pricing/markup.ts) selects the most specific
-- matching rule (with a default fallback) to turn a supplier NET into a client
-- SELL. Idempotent; safe to re-run.

create table if not exists public.markup_rules (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  -- scope the markup applies at
  scope text not null default 'per_hotel_line' check (scope in ('per_room_night', 'per_hotel_line', 'package')),
  markup_type text not null default 'percentage' check (markup_type in ('percentage', 'fixed')),
  markup_value numeric(12, 2) not null default 0,
  -- match criteria (null = wildcard)
  country text,
  city text,
  supplier_id text,
  star_rating int,
  season_start text, -- "MM-DD"
  season_end text,   -- "MM-DD"
  customer_type text check (customer_type is null or customer_type in ('individual', 'corporate', 'vip')),
  is_default boolean not null default false,
  -- constraints
  min_margin_pct numeric(8, 2),
  rounding_mode text check (rounding_mode is null or rounding_mode in ('up', 'nearest', 'down')),
  rounding_step numeric(10, 2),
  priority int not null default 0,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

-- Seed a single all-wildcard default rule so pricing always has a fallback:
-- +20% per hotel line, minimum 8% margin, round the sell up to the nearest 5.
insert into public.markup_rules
  (arabic_name, english_name, scope, markup_type, markup_value, is_default, min_margin_pct, rounding_mode, rounding_step, priority, status)
select 'قاعدة الهامش الافتراضية', 'Default markup', 'per_hotel_line', 'percentage', 20, true, 8, 'up', 5, 0, 'Active'
where not exists (select 1 from public.markup_rules where is_default = true);

do $$ begin
  execute 'alter table public.markup_rules enable row level security';
  execute 'drop policy if exists authenticated_all on public.markup_rules';
  execute 'create policy authenticated_all on public.markup_rules for all to authenticated using (true) with check (true)';
end $$;


-- ═══════════════ 0014_offer_hotels_sourcing.sql ═══════════════

-- App Travluin — supplier-sourcing + client-safety fields on offer hotel lines.
-- These carry the supplier rate a hotel line was priced from so the render
-- snapshot (offer_renders.snapshot_json) freezes a complete, reproducible audit
-- trail. The CLIENT-SAFE columns (cancellation_policy, excluded_surcharges,
-- valid_until) surface to the client document; the rest are INTERNAL cost basis
-- and are structurally stripped from the client DTO (src/lib/offer/dto.ts).
-- Idempotent; safe to re-run.

alter table public.offer_hotels
  -- client-safe
  add column if not exists cancellation_policy text,
  add column if not exists excluded_surcharges jsonb not null default '[]'::jsonb,
  add column if not exists valid_until date,
  -- INTERNAL supplier sourcing / cost basis
  add column if not exists supplier_id text,
  add column if not exists supplier_name text,
  add column if not exists rate_key text,
  add column if not exists net_base numeric(12, 2),
  add column if not exists net_source_currency text,
  add column if not exists fx_rate numeric(14, 6),
  add column if not exists fx_date date,
  add column if not exists ref_sell_base numeric(12, 2),
  add column if not exists markup_amount numeric(12, 2),
  add column if not exists markup_pct numeric(8, 2);


-- ═══════════════ 0015_hotel_suppliers.sql ═══════════════

-- App Travluin — hotel supplier registry + static content cache + audit log.
-- Machine-to-machine supplier credentials are stored ENCRYPTED (AES-256-GCM;
-- see src/lib/crypto/secrets.ts) — never plaintext. Content is cached separately
-- from live rates (rates are never cached). Idempotent; safe to re-run.

-- ---------- hotel_suppliers: the registry (admin-managed) ----------
create table if not exists public.hotel_suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- 'tbo' | 'hotelbeds' | 'agoda'
  name_ar text not null,
  name_en text,
  enabled boolean not null default false,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'live')),
  base_url text,
  -- base64(iv|tag|ciphertext); decryptable only with SETTINGS_ENCRYPTION_KEY (server env).
  credentials_encrypted text,
  priority int not null default 100,         -- lower = queried first
  default_markup_rule_id uuid references public.markup_rules (id) on delete set null,
  last_sync_at timestamptz,
  last_sync_status text,                     -- 'ok' | 'error' | null
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed the TBO row (disabled, no credentials — the admin adds them via Settings).
insert into public.hotel_suppliers (code, name_ar, name_en, enabled, environment, priority)
select 'tbo', 'TBO Holidays', 'TBO Holidays', false, 'sandbox', 10
where not exists (select 1 from public.hotel_suppliers where code = 'tbo');

-- ---------- hotel_content_cache: STATIC content (fetched once, refreshed on a schedule) ----------
create table if not exists public.hotel_content_cache (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  supplier_hotel_id text not null,
  internal_hotel_id uuid references public.hotels (id) on delete set null,
  name_ar text,
  name_en text,
  star_rating int,
  address text,
  lat double precision,
  lng double precision,
  description text,
  images jsonb not null default '[]'::jsonb,               -- [{url, order, caption}]
  facilities jsonb not null default '[]'::jsonb,           -- ['pool','spa','gym',...]
  room_type_catalogue jsonb not null default '[]'::jsonb,  -- [{code,name_ar,name_en}]
  check_in_time text,
  check_out_time text,
  content_synced_at timestamptz not null default now(),
  content_source text,
  created_at timestamptz not null default now(),
  unique (supplier, supplier_hotel_id)
);

-- ---------- audit_logs: who changed what, when (NEVER the secret value) ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.employees (id) on delete set null,
  actor_email text,
  action text not null,                      -- 'supplier.credentials_changed' etc.
  entity text,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,    -- non-secret context only
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------- row-level security ----------
-- All three tables are authenticated-only (never anon). The credential blob is
-- useless without the server-only encryption key, and the data-action layer
-- additionally gates every read/write on the ADMIN role. The public client link
-- reads hotel content from the FROZEN offer snapshot, never from these tables.
do $$
declare t text;
begin
  foreach t in array array['hotel_suppliers', 'hotel_content_cache', 'audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists authenticated_all on public.%I', t);
    execute format('create policy authenticated_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;


-- ═══════════════ 0016_offer_hotels_content.sql ═══════════════

-- App Travluin — client-safe hotel CONTENT on offer hotel lines. These come from
-- the static content cache (image, facilities, stars) at selection time and are
-- frozen into the render snapshot. They are CLIENT-SAFE (the client PDF shows the
-- image + facilities) — unlike the supplier/net/rate_key fields (0014) which are
-- structurally stripped from ClientOfferDTO. Idempotent.

alter table public.offer_hotels
  add column if not exists image_url text,
  add column if not exists facilities jsonb not null default '[]'::jsonb,
  add column if not exists content_star_rating int,
  -- the RATE's room name (supplier-sourced hotels have no internal room_type_id)
  add column if not exists room_type_name text;


-- ═══════════════ 0017_lock_supplier_credentials.sql ═══════════════

-- App Travluin — lock the supplier credential vault + audit log to the SERVICE ROLE.
-- The previous 0015 policy (`for all to authenticated`) let ANY signed-in employee
-- read the credential ciphertext / base_url and even overwrite/delete credentials via
-- direct PostgREST, bypassing the admin-gated server actions. Fix: drop the permissive
-- policy so RLS (still enabled) denies anon + authenticated entirely; the service-role
-- client (RLS-bypassing, server-only, admin-gated in app code) is the ONLY access path.
-- hotel_content_cache stays authenticated-readable (no secrets). Idempotent.

do $$ begin
  execute 'drop policy if exists authenticated_all on public.hotel_suppliers';
  execute 'drop policy if exists authenticated_all on public.audit_logs';
  -- RLS remains ENABLED with no permissive policy → anon/authenticated get nothing.
  execute 'alter table public.hotel_suppliers enable row level security';
  execute 'alter table public.audit_logs enable row level security';
end $$;
