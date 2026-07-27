-- App Travluin — reference data for the destinations the company actually sells.
--
-- The generator cascades country → cities → hotels → room types, but the tables
-- held only 10 cities and 2 hotels while offers and «العروض الجاهزة» span 13
-- destinations, so picking a country showed an empty city list. This seeds the
-- missing countries, their cities, and — generated rather than hand-written —
-- three test hotels per city and three room types per hotel.
--
-- Idempotent: every insert is guarded, so re-running adds nothing.

-- ---------- 1. countries the ready offers reference but we never had ----------
insert into public.countries (arabic_name, english_name, iso2, status)
select v.ar, v.en, v.iso, 'Active'
from (values
  ('جنوب أفريقيا', 'South Africa', 'ZA'),
  ('سنغافورة', 'Singapore', 'SG'),
  ('أذربيجان', 'Azerbaijan', 'AZ'),
  ('جورجيا', 'Georgia', 'GE')
) as v(ar, en, iso)
where not exists (select 1 from public.countries c where c.iso2 = v.iso);

-- ---------- 2. airports the seeded routes need ----------
insert into public.airports (arabic_name, english_name, code, status)
select v.ar, v.en, v.code, 'Active'
from (values
  ('مطار بوسان الدولي', 'Gimhae International', 'PUS'),
  ('مطار كيب تاون الدولي', 'Cape Town International', 'CPT'),
  ('مطار جوهانسبرغ', 'O.R. Tambo International', 'JNB')
) as v(ar, en, code)
where not exists (select 1 from public.airports a where a.code = v.code);

-- ---------- 3. cities ----------
-- Matched to the country by iso2 so an Arabic spelling variant can never orphan
-- a city (the table holds «اندونيسيا» while the offer sheet writes «إندونيسيا»).
insert into public.cities (country_id, arabic_name, english_name)
select c.id, v.ar, v.en
from (values
  ('MY', 'جوهور بارو', 'Johor Bahru'),
  ('MY', 'ملاكا', 'Malacca'),
  ('MY', 'كوتا كينابالو', 'Kota Kinabalu'),
  ('ID', 'يوجياكارتا', 'Yogyakarta'),
  ('ID', 'سورابايا', 'Surabaya'),
  ('TH', 'بانكوك', 'Bangkok'),
  ('TH', 'فوكيت', 'Phuket'),
  ('TH', 'شيانغ ماي', 'Chiang Mai'),
  ('TH', 'كرابي', 'Krabi'),
  ('TH', 'باتايا', 'Pattaya'),
  ('VN', 'هانوي', 'Hanoi'),
  ('VN', 'دانانغ', 'Da Nang'),
  ('VN', 'هوي آن', 'Hoi An'),
  ('VN', 'فوكوك', 'Phu Quoc'),
  ('VN', 'سابا', 'Sapa'),
  ('VN', 'هو تشي منه', 'Ho Chi Minh City'),
  ('TR', 'طرابزون', 'Trabzon'),
  ('TR', 'أنطاليا', 'Antalya'),
  ('TR', 'بورصة', 'Bursa'),
  ('TR', 'أوزنغول', 'Uzungol'),
  ('TR', 'كابادوكيا', 'Cappadocia'),
  ('KR', 'سيول', 'Seoul'),
  ('KR', 'بوسان', 'Busan'),
  ('KR', 'جيجو', 'Jeju'),
  ('RU', 'موسكو', 'Moscow'),
  ('RU', 'سانت بطرسبرغ', 'Saint Petersburg'),
  ('ZA', 'كيب تاون', 'Cape Town'),
  ('ZA', 'جوهانسبرغ', 'Johannesburg'),
  ('EG', 'القاهرة', 'Cairo'),
  ('EG', 'شرم الشيخ', 'Sharm El Sheikh'),
  ('EG', 'الغردقة', 'Hurghada'),
  ('AE', 'دبي', 'Dubai'),
  ('AE', 'أبوظبي', 'Abu Dhabi'),
  ('SG', 'سنغافورة', 'Singapore'),
  ('AZ', 'باكو', 'Baku'),
  ('GE', 'تبليسي', 'Tbilisi'),
  ('GE', 'باتومي', 'Batumi'),
  ('SA', 'المدينة المنورة', 'Madinah'),
  ('SA', 'مكة المكرمة', 'Makkah'),
  ('SA', 'الرياض', 'Riyadh'),
  ('SA', 'جدة', 'Jeddah')
) as v(iso, ar, en)
join public.countries c on c.iso2 = v.iso
where not exists (
  select 1 from public.cities ci where ci.country_id = c.id and ci.arabic_name = v.ar
);

-- ---------- 4. three test hotels per city ----------
-- Generated from the city list rather than typed out, so a city added later
-- gets its hotels by simply re-running this file.
insert into public.hotels (city_id, country_id, arabic_name, english_name, stars, is_default)
select ci.id, ci.country_id,
       'فندق ' || ci.arabic_name || ' ' || t.ar,
       coalesce(ci.english_name, ci.arabic_name) || ' ' || t.en,
       t.stars,
       t.is_def
from public.cities ci
cross join (values
  ('بلازا', 'Plaza', 5, true),
  ('سنتر', 'Center', 4, false),
  ('إن', 'Inn', 3, false)
) as t(ar, en, stars, is_def)
where not exists (
  select 1 from public.hotels h
  where h.city_id = ci.id and h.arabic_name = 'فندق ' || ci.arabic_name || ' ' || t.ar
);

-- ---------- 5. three room types per hotel ----------
insert into public.room_types (hotel_id, arabic_name, english_name, default_board)
select h.id, r.ar, r.en, r.board
from public.hotels h
cross join (values
  ('غرفة مزدوجة', 'Double Room', 'BB'),
  ('غرفة ثلاثية', 'Triple Room', 'BB'),
  ('جناح', 'Suite', 'HB')
) as r(ar, en, board)
where not exists (
  select 1 from public.room_types rt where rt.hotel_id = h.id and rt.arabic_name = r.ar
);

-- ---------- 6. test flight routes ----------
insert into public.flights (carrier, from_airport, to_airport, cabin, baggage, type)
select v.carrier, v.f, v.t, v.cabin, v.bag, v.kind
from (values
  ('الخطوط السعودية', 'JED', 'KUL', 'الاقتصادية', '30 كجم', 'دولي'),
  ('الخطوط السعودية', 'KUL', 'JED', 'الاقتصادية', '30 كجم', 'دولي'),
  ('طيران ناس', 'RUH', 'BKK', 'الاقتصادية', '25 كجم', 'دولي'),
  ('الخطوط التركية', 'JED', 'IST', 'الاقتصادية', '30 كجم', 'دولي'),
  ('الخطوط التركية', 'IST', 'JED', 'الاقتصادية', '30 كجم', 'دولي'),
  ('طيران الإمارات', 'MED', 'DXB', 'الاقتصادية', '30 كجم', 'دولي'),
  ('الخطوط القطرية', 'JED', 'HAN', 'الاقتصادية', '30 كجم', 'دولي'),
  ('الخطوط الكورية', 'JED', 'ICN', 'الاقتصادية', '30 كجم', 'دولي'),
  ('AirAsia', 'KUL', 'PEN', 'الاقتصادية', '20 كجم', 'داخلي'),
  ('AirAsia', 'KUL', 'LGK', 'الاقتصادية', '20 كجم', 'داخلي'),
  ('Batik Air', 'CGK', 'DPS', 'الاقتصادية', '20 كجم', 'داخلي'),
  ('Thai Airways', 'BKK', 'HKT', 'الاقتصادية', '20 كجم', 'داخلي'),
  ('Vietnam Airlines', 'HAN', 'SGN', 'الاقتصادية', '20 كجم', 'داخلي'),
  ('Turkish Airlines', 'IST', 'TZX', 'الاقتصادية', '20 كجم', 'داخلي'),
  ('Korean Air', 'ICN', 'PUS', 'الاقتصادية', '20 كجم', 'داخلي'),
  ('South African', 'JNB', 'CPT', 'الاقتصادية', '20 كجم', 'داخلي')
) as v(carrier, f, t, cabin, bag, kind)
where not exists (
  select 1 from public.flights fl
  where fl.carrier = v.carrier and fl.from_airport = v.f and fl.to_airport = v.t
);
