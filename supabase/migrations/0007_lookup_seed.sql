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
