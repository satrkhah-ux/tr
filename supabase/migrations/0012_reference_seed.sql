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
