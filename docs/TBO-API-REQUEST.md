# طلب تفعيل API من TBO Holidays

رسالة **شريك قائم** يطلب الانتقال من الحجز عبر المنصة إلى الحجز عبر API — لا طلب شراكة جديد.
لا مرفقات: التعاقد قائم بيننا وبيانات الشركة لديهم.

- **من:** Ahmed Alrifaie — `it@traveliun.com`
- **إلى:** مدير حسابكم في TBO (العنوان الذي تراسلونه أصلًا). TBO لا تنشر بريدًا عامًا للـAPI.
- **نسخة:** `info@traveliun.com`

ملف جاهز للفتح والإرسال: [`TBO-API-REQUEST.eml`](TBO-API-REQUEST.eml) — افتحه بالنقر المزدوج، أضف عنوان
المستلم، ثم Send.

---

## Subject

```
API Access Request — Existing TBO Partner — Traveliun Travel & Tourism (CR 4650080546)
```

---

## نص الإيميل

```
Dear TBO Team,

Traveliun Travel & Tourism (ترافليون للسفر والسياحة) is an existing TBO partner.
We have been booking with you for several years through your platform directly,
and we would now like to move our hotel booking onto the TBO Holidays Hotel API.

Our licence and registration details, so you can locate our account:

  Legal name             : Traveliun Travel & Tourism (ترافليون للسفر والسياحة)
  Commercial Registration: 4650080546
  Unified National Number: 7007652352
  Tourism licence        : 73100402 — category: Travel & Tourism Agency
  VAT number             : 302023121500003
  Country                : Kingdom of Saudi Arabia
  Address                : Al Iskan District, Abdul Salam Ibn Hafs Street,
                           Al Madinah Al Munawwarah
  Corporate website      : https://www.traveliun.com.sa
  Booking platform       : https://pkg.traveliun.com
  Phone / WhatsApp       : +966 56 922 2111

Since we already have a signed agreement with TBO, we assume no further
documentation is required — please tell us if anything is outstanding on your
side and we will provide it the same day.

────────────────────────────────────────────────────────────
WHAT WE ARE REQUESTING
────────────────────────────────────────────────────────────
1. Test (sandbox) credentials for the TBO Holidays Hotel API, together with the
   sandbox service endpoint for our account.
2. Production credentials and endpoint once we pass your certification.
3. Current API documentation, and your rate limits for search and content calls.
4. The certification checklist you require before production access is granted.
5. The API support contact we should work with during integration.

────────────────────────────────────────────────────────────
INTEGRATION STATUS ON OUR SIDE — ALREADY BUILT
────────────────────────────────────────────────────────────
Our platform is in production, and the TBO connector is already written. No
development work is pending on our side — we are waiting only for credentials.

• A dedicated TBO adapter over HTTPS, HTTP Basic authentication, JSON payloads,
  against https://api.tbotechnology.in/TBOHolidays_HotelAPI — configurable, so we
  can switch to the per-account host you issue us.

• Integrated end to end:
      CountryList        — our authentication health check
      CityList           — city-code resolution within a country
      TBOHotelCodeList   — hotel inventory per city
      Hoteldetails       — static content: description, images, facilities
      search             — live availability and net rates for exact dates
                           and occupancy

• Separate sandbox and production configuration, each with its own service
  endpoint. The system refuses to operate in sandbox mode until your sandbox host
  has been entered — it will never silently fall back to the production host.

• Rate-limit discipline: your STATIC content (descriptions, images, facilities) is
  fetched once per hotel and cached on our side, so it is not re-requested on every
  search. LIVE rates are never cached — they are fetched fresh for every quote and
  re-validated before any rate is shown.

• Fail-closed behaviour: if a call fails, times out, or returns a non-success
  status, our system reports "no results". It never substitutes cached, estimated
  or generated rates for live ones. There is no code path by which a customer can
  be quoted a price that did not come from TBO.

────────────────────────────────────────────────────────────
SECURITY AND INFRASTRUCTURE
────────────────────────────────────────────────────────────
• Credentials are encrypted at rest with AES-256-GCM, decrypted only inside the
  server process, and are never sent to the browser or exposed after entry.

• Your net rates are treated as confidential supplier data and are stripped at a
  dedicated redaction layer before any customer-facing document, link or PDF is
  produced. Customers see only our published selling price.

• The platform runs over HTTPS on a dedicated server with static addressing.
  For your whitelist:

        IPv4 : 187.124.112.104
        IPv6 : 2a02:4780:f:f3ad::1

  Please whitelist BOTH. Our server is dual-stack, so an IPv4-only whitelist can
  cause intermittent rejections when outbound traffic egresses over IPv6.

• Every call carries a 25-second timeout and full server-side logging of endpoint,
  HTTP status and your returned status code — so any issue during certification can
  be diagnosed quickly and precisely.

────────────────────────────────────────────────────────────
SCOPE
────────────────────────────────────────────────────────────
To be clear about our current stage: search, live rates and static content are
implemented. The booking flow (pre-book / book / cancel) is not yet wired to your
API — we would like to complete it against your sandbox as part of certification,
and we would welcome your guidance on the exact endpoints involved.

We are ready to begin testing the day credentials are issued.

Kind regards,

Ahmed Alrifaie
Traveliun Travel & Tourism
it@traveliun.com · +966 56 922 2111
https://www.traveliun.com.sa
```

---

## بعد وصول البيانات

1. `/settings/suppliers` ← صف **TBO Holidays**.
2. البيئة = «تجريبي» + الصق **رابط البيئة التجريبية** الذي أرسلوه — بدونه يرفض النظام الاتصال عمدًا،
   حتى لا تظن أنك تختبر بينما أنت تضرب الحساب المباشر.
3. اسم المستخدم وكلمة المرور ← تُخزَّن مشفّرة AES-256-GCM.
4. زر **اختبار الاتصال** — يستدعي `CountryList` ويخبرك بعدد الدول التي رجعت.
5. بعد اجتياز الاعتماد: البيئة = «مباشر» + رابط الإنتاج، ثم فعّل الصف.
