# طلب تفعيل API من TBO Holidays

هذا الملف يحتوي نص الإيميل جاهزًا للإرسال، وقائمة بالحقول التي عليك ملؤها قبل الإرسال.

**كل ما بين `[[ ]]` يجب أن تملأه أنت — لم أخترع أي رقم سجل أو ترخيص أو حجم أعمال.**

- **إلى:** مدير حسابك في TBO، أو فريق دعم الـAPI بعد التسجيل عبر <https://www.tbo.com/tbo-api> («Register Now»).
  TBO لا تنشر بريدًا مخصّصًا للـAPI على موقعها، فاستخدم القناة التي لديك.
- **نسخة:** `info@traveliun.com`
- **المرفقات المقترحة:** السجل التجاري · رخصة السياحة · الشهادة الضريبية · شعار الشركة.

---

## Subject

```
API Access Request — Traveliun Travel & Tourism, Al Madinah, Saudi Arabia (Hotel API)
```

---

## نص الإيميل

```
Dear TBO Partner Team,

I am writing on behalf of Traveliun Travel & Tourism (ترافليون للسفر والسياحة),
a licensed travel agency based in Al Madinah Al Munawwarah, Saudi Arabia. We would
like to request API credentials for the TBO Holidays Hotel API.

────────────────────────────────────────────────────────────
1. COMPANY DETAILS
────────────────────────────────────────────────────────────
Legal name          : Traveliun Travel & Tourism (ترافليون للسفر والسياحة)
Country             : Kingdom of Saudi Arabia
Address             : Al Iskan District, Abdul Salam Ibn Hafs Street,
                      Al Madinah Al Munawwarah
Commercial Reg. (CR): [[رقم السجل التجاري]]
Tourism licence     : [[رقم رخصة وزارة السياحة]]
VAT number          : [[الرقم الضريبي]]
Corporate website   : https://www.traveliun.com.sa
Booking platform    : https://pkg.traveliun.com
Phone / WhatsApp    : +966 56 922 2111
Email               : info@traveliun.com

Our business is outbound leisure and group travel for the Saudi market, plus
inbound accommodation in Makkah and Al Madinah. Being based in Al Madinah, hotel
content for the Haramain cities is of particular commercial interest to us, and we
would also like to discuss your Umrah API at a later stage.

Estimated volume    : [[عدد الحجوزات أو الليالي الفندقية المتوقعة شهريًا]]
Primary markets     : Saudi Arabia (source) → [[الوجهات الرئيسية]]

────────────────────────────────────────────────────────────
2. WHAT WE ARE REQUESTING
────────────────────────────────────────────────────────────
a) Test (sandbox) credentials for the TBO Holidays Hotel API, together with the
   sandbox service endpoint for our account.
b) The production endpoint and credentials once we pass your certification.
c) The current API documentation, and your rate limits / permitted call volume for
   search and content endpoints.
d) Confirmation of the contracting model you would like to apply to us
   (net rates + our own markup is our expectation) and the settlement terms.
e) The name of the account manager and the API support contact we should work with.

────────────────────────────────────────────────────────────
3. INTEGRATION STATUS ON OUR SIDE — ALREADY COMPLETE
────────────────────────────────────────────────────────────
Our platform is built and in production. The TBO connector is already written and
waiting only for credentials — no development work is pending before we can start
testing. Specifically:

• A dedicated TBO adapter implementing your HotelAPI over HTTPS with HTTP Basic
  authentication and JSON payloads, against
  https://api.tbotechnology.in/TBOHolidays_HotelAPI
  (configurable, so we can switch to the per-account host you issue us).

• The following endpoints are integrated end to end:
      - CountryList        (used as our authentication health check)
      - CityList           (city-code resolution within a country)
      - TBOHotelCodeList   (hotel inventory per city)
      - Hoteldetails       (static content: description, images, facilities)
      - search             (live availability and net rates for exact dates
                            and occupancy)

• Separate sandbox and production configuration. Each environment carries its own
  service endpoint, and the system refuses to run in sandbox mode until your
  sandbox host has been entered — it will never silently fall back to production.

• Rate-limit discipline: your STATIC content (hotel descriptions, images,
  facilities) is fetched once per hotel and cached on our side, so it is not
  re-requested on every search. LIVE rates are never cached — they are fetched
  fresh for every quote and re-validated before a rate is presented to a customer.

• Fail-closed behaviour: if a TBO call fails, times out, or returns a non-success
  status, our system shows "no results". It never substitutes estimated,
  cached, or generated rates for live ones. There is no code path in which a
  customer can be quoted a price that did not come from you.

────────────────────────────────────────────────────────────
4. SECURITY AND INFRASTRUCTURE
────────────────────────────────────────────────────────────
• Credentials are stored encrypted at rest with AES-256-GCM, decrypted only inside
  the server process, and are never transmitted to the browser or exposed to our
  own staff after entry.

• Your net rates are treated as confidential supplier data: they are stripped at a
  dedicated redaction layer before any customer-facing document, link or PDF is
  generated. Customers see only our published selling price.

• The platform runs over HTTPS with a valid certificate on a dedicated server with
  a static IP address. For your whitelist:

      IPv4 : 187.124.112.104
      IPv6 : 2a02:4780:f:f3ad::1

  Please whitelist BOTH addresses. Our server is dual-stack, so an IPv4-only
  whitelist can result in intermittent rejections when outbound traffic egresses
  over IPv6.

• Every call carries a 25-second timeout and full server-side logging of endpoint,
  HTTP status and your returned status code, which will let us diagnose any issue
  during certification quickly and precisely.

────────────────────────────────────────────────────────────
5. SCOPE NOTE
────────────────────────────────────────────────────────────
To be transparent about our current stage: our platform is a quotation and package
system. What is implemented today is search, live rates and static content. The
booking flow (pre-book / book / cancellation) is not yet wired to your API — we
would like to complete it against your sandbox as part of certification, and we
would appreciate your guidance on the exact endpoints and the certification
checklist you require before production access is granted.

────────────────────────────────────────────────────────────
6. DOCUMENTS
────────────────────────────────────────────────────────────
Attached: [[اذكر ما أرفقته فعلًا]]

Please tell us if you require anything further — a signed agreement, additional
company documentation, or a technical questionnaire — and we will return it the
same day.

────────────────────────────────────────────────────────────
7. CONTACTS
────────────────────────────────────────────────────────────
Commercial : [[الاسم]], [[المسمّى]] — [[البريد]] — [[الجوال]]
Technical  : [[الاسم]], [[المسمّى]] — [[البريد]] — [[الجوال]]

We are ready to begin testing as soon as credentials are issued, and we look
forward to a long partnership with TBO.

Kind regards,

[[الاسم الكامل]]
[[المسمّى الوظيفي]]
Traveliun Travel & Tourism
+966 56 922 2111 · info@traveliun.com
https://www.traveliun.com.sa
```

---

## ما ينقص قبل الإرسال

| الحقل | ملاحظة |
|---|---|
| رقم السجل التجاري | من وثيقة الشركة |
| رقم رخصة وزارة السياحة | TBO تطلبها للتحقق من كون الشريك وكالة مرخّصة |
| الرقم الضريبي | اختياري لكنه يسرّع التعاقد |
| حجم الأعمال المتوقع شهريًا | يحدّد شريحة الأسعار التي يعطونك إياها — لا تتركه فارغًا |
| الوجهات الرئيسية | ماليزيا · تركيا · جورجيا · إندونيسيا … (من عروض الصيف) |
| جهات الاتصال التجارية والتقنية | اسم وبريد وجوال لكل منهما |

## بعد وصول البيانات

1. `/settings/suppliers` ← صف **TBO Holidays**.
2. البيئة = «تجريبي» + الصق **رابط البيئة التجريبية** الذي أرسلوه (بدونه يرفض النظام الاتصال — عمدًا).
3. اسم المستخدم وكلمة المرور ← تُخزَّن مشفّرة.
4. زر **اختبار الاتصال** — يستدعي `CountryList` ويخبرك بعدد الدول التي رجعت.
5. بعد اجتياز الاعتماد: البيئة = «مباشر» + رابط الإنتاج، ثم فعّل الصف.
