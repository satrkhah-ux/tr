# نشر App Travluin / Traveliun على Netlify (سحب من GitHub)

دليل خطوة‑بخطوة لنشر التطبيق على **Netlify** مع بناء تلقائي من مستودع GitHub `satrkhah-ux/tr`.

> الملفات التي هيّأت المشروع للنشر (مُودَعة في المستودع):
> `netlify.toml` · `next.config.ts` (إخراج مشروط + تتبّع الخطوط/Chromium) · `src/lib/offer-doc/pdf.ts` (Chromium بلا متصفّح على الخادم) · `maxDuration` على مسارات الـ PDF/الصورة · تبعيّة `@sparticuz/chromium`.

---

## 0) الخلاصة في سطر
Netlify يدعم **Next.js 16** أصلًا. البناء يعمل. تبقّى شيئان يجب أن تضبطيهما أنتِ في لوحة Netlify:
1. **متغيّرات البيئة** (خصوصًا `NEXT_PUBLIC_SUPABASE_URL` — **يجب أن يكون HTTPS**).
2. اختيار قاعدة Supabase (الموصى به على Netlify: **السحابية https**).

---

## 1) ارفعي الكود إلى GitHub
Netlify يبني من فرع `main` في `satrkhah-ux/tr`. لذا ادفعي التعديلات أولًا:

```bash
git add netlify.toml next.config.ts package.json package-lock.json src/ deploy/
git commit -m "chore(deploy): configure Netlify (serverless Chromium, fonts tracing, runtime env)"
git push origin main
```

## 2) اربطي المستودع بـ Netlify
1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project** → **GitHub**.
2. اختاري مستودع `satrkhah-ux/tr`، الفرع `main`.
3. إعدادات البناء تُقرأ تلقائيًا من `netlify.toml` (الأمر `npm run build`، مجلّد `.next`، Node 24، إضافة Next.js). لا تغيّري شيئًا هنا.
4. **لا تنشري بعد** — اضبطي المتغيّرات أولًا (الخطوة 3) وإلا سيفشل الدخول.

## 3) متغيّرات البيئة (Site configuration → Environment variables)
انسخي القيم من `.env.local` عندك. الحقول المطلوبة:

| المتغيّر | النطاق | ملاحظة |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All | **HTTPS إلزامي** (انظري الخطوة 4) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | مفتاح عام — آمن |
| `SUPABASE_SERVICE_ROLE_KEY` | All (سرّي) | خادم فقط — لا تضيفي `NEXT_PUBLIC_` |
| `SETTINGS_ENCRYPTION_KEY` | All (سرّي) | لازم فقط لميزة بيانات الموردين (خزنة AES) |

اختيارية (لها بدائل افتراضية — تجاهلها آمن): `HOTEL_PROVIDER` · `FLIGHT_PROVIDER` · `AMADEUS_CLIENT_ID`/`AMADEUS_CLIENT_SECRET` (فقط مع مزوّد amadeus) · `RATES_API_URL` · `TBO_LIVE`.

**لا تضيفي** على Netlify: `SUPABASE_DB_URL`, `SUPABASE_MGMT_TOKEN`, `SUPABASE_PROJECT_REF` (أدوات محلية فقط)، ولا متغيّرات `TELEGRAM_*`/`BOT_*`/`PHANTOM_*` (بقايا قوالب لا تخصّ ترافليون).

## 4) قاعدة Supabase — لماذا HTTPS ضروري
موقع Netlify يُقدَّم عبر **HTTPS**، والمتصفّح **يحجب** أي نداء إلى `http://` من صفحة https (Mixed Content). لذا `NEXT_PUBLIC_SUPABASE_URL` **يجب أن يكون https**:

- **الخيار A (موصى به، بلا بنية تحتية):** استخدمي مشروع Supabase **السحابي** `https://rpuxdgrypnmihgmbeunq.supabase.co` (وهو أصلًا في `.env.local` ويحوي المخطّط + بياناتك + مستخدم الأدمن). مفاتيح anon/service من نفس المشروع.
- **الخيار B (إبقاء الاستضافة الذاتية على VPS):** ضعي Kong خلف **دومين TLS حقيقي** (`https://api.yourdomain.com` عبر عاكس/بروكسي) — لأن `http://187.124.112.104:8000` لن يعمل أبدًا على موقع https. ثم استخدمي ذلك العنوان.

> الاستضافة الذاتية على VPS (Coolify) بروتوكولها http حاليًا، لذا هي مناسبة لنشر Coolify — لا لـ Netlify. لـ Netlify اختاري السحابة (A).

**تحميل قاعدة البيانات** (إن كانت القاعدة الهدف فارغة): طبّقي `deploy/deploy-all.sql` مرّة واحدة (Supabase Studio → SQL Editor → Run، أو `psql "$DB_URL" -f deploy/deploy-all.sql`). القاعدة السحابية `rpuxdg` عادةً محمّلة أصلًا.

## 5) انشري وسجّلي الدخول
1. **Deploy site**. أول بناء ~2–4 دقائق.
2. افتحي رابط `*.netlify.app` → `admin@admin.com` / `Traveliun#2026`.
3. **غيّري كلمة المرور فورًا** (الحساب ← تغيير كلمة المرور) — فهي مكشوفة في المستودع العام.

---

## تنبيهات مهمّة (اقرئيها)
- **توليد الـ PDF (Chromium على الخادم):** هيّأته ليعمل عبر `@sparticuz/chromium`. لكنه أثقل ميزة على بيئة Netlify: بارد ~1–3 ثوانٍ، وقد يقترب من حدّ حجم الدالة، ويحتاج مهلة تصل إلى **26s** (أضفتها عبر `maxDuration`) — وهذا يتطلّب خطة Netlify تسمح بذلك. إن أزعجك: أبقِ ميزة الـ PDF على VPS، أو انقُلها لدالة خلفية تكتب الملف إلى Supabase Storage. (بقيّة التطبيق خفيف ويعمل بلا مشاكل.)
- **بوّابة الدخول `proxy.ts`:** هي صيغة Next 16 الجديدة (بديل `middleware.ts`). بعد أول نشر، تأكّدي أن زيارة مسار محمي بدون تسجيل دخول تُحوّلك إلى `/sign-in`. إن لم تُحوّل، فنسخة إضافة Netlify قديمة — حدّثيها أو أعيدي تسمية الملف مؤقتًا إلى `src/middleware.ts` بتصدير `middleware`.
- **بقايا غير مستخدمة:** مسارات `src/app/api/telegram/*` وصفحات `kyc/markets/p2p/trade/wallet…` بقايا قوالب (تداول/تلغرام). لا تكسر النشر، لكن يُستحسن حذفها لاحقًا لتقليل الحجم وسطح البيئة.
- **الأمان:** تأكّدي أن `.env.local` في `.gitignore` ولم يُدفع. إن كان قد دُفع سابقًا فدوّري: `SUPABASE_SERVICE_ROLE_KEY`, كلمة مرور قاعدة البيانات, وأي توكنات. ضعي كل الأسرار في Netlify فقط.
- **الترقية الأمنية:** توصي Netlify برفع `next` إلى `16.2.6` (أنتِ على `16.2.1`) وفق تنبيه أمان مايو 2026 — `npm i next@16.2.6 eslint-config-next@16.2.6` ثم أعيدي البناء.

## أخطاء شائعة
- **الدخول يفشل بصمت / لا تُحمّل بيانات** → `NEXT_PUBLIC_SUPABASE_URL` بروتوكوله http (Mixed Content). اجعليه https.
- **500 على `/sign-in`** → `NEXT_PUBLIC_SUPABASE_*` غير مضبوطة في Netlify.
- **PDF يعطي 500** → غالبًا مهلة الدالة أو حجمها؛ راجعي سجلّ الدالة في Netlify.
