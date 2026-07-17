# نشر App Travluin على Coolify مع Supabase ذاتي الاستضافة

دليل خطوة‑بخطوة. الملف المرافق: **`deploy/deploy-all.sql`** (كل الهجرات 0001→0017 + بذر المرجع + الأدمن).

> ملاحظة مهمة: التطبيق يحتاج **Supabase كاملًا** (Auth + PostgREST + Storage) — لا يعمل على PostgreSQL عادي.

---

## 1) انشري Supabase على Coolify
1. Coolify → **+ New Resource** → **Services** → اختاري **Supabase** (قالب جاهز).
2. انشريه وانتظري حتى تعمل كل الحاويات (postgres, auth/gotrue, rest, realtime, storage, kong, studio).
3. أعطي **Kong/API** دومينًا عامًا قابلًا للوصول من المتصفّح (هذا سيصبح `NEXT_PUBLIC_SUPABASE_URL`).

## 2) اجمعي مفاتيح Supabase ذاتية الاستضافة
من صفحة خدمة Supabase على Coolify → **Environment Variables**، انسخي:
| القيمة على Coolify | ستستخدمينها كـ |
|---|---|
| `SUPABASE_URL` أو دومين Kong العام | `NEXT_PUBLIC_SUPABASE_URL` |
| `ANON_KEY` / `SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |
| `POSTGRES_PASSWORD` + مضيف postgres | لبناء `SUPABASE_DB_URL` |

> ⚠️ استخدمي مفاتيح **الاستضافة الذاتية** فقط (مُوقّعة بـ `JWT_SECRET` الخاص بها). لا تخلطيها مع مفاتيح السحابة (rpuxdg).

`SUPABASE_DB_URL` = `postgresql://postgres:<POSTGRES_PASSWORD>@<db-host>:5432/postgres`

## 3) طبّقي المخطّط (deploy-all.sql)
- افتحي **Supabase Studio** (يعرضه Coolify) → **SQL Editor** → الصقي محتوى `deploy/deploy-all.sql` → **Run**.
- أو عبر psql: `psql "$SUPABASE_DB_URL" -f deploy/deploy-all.sql`
- النتيجة: كل الجداول + الدول/المطارات/أنواع النقل + مستخدم الأدمن.

> إن فشل إدخال الأدمن في `auth.users` (بسبب اختلاف نسخة GoTrue): أنشئيه يدويًا من **Studio → Authentication → Add user** ببريد `admin@admin.com` (مع email confirmed)، ثم:
> `update public.employees set auth_user_id=(select id from auth.users where email='admin@admin.com') where email='admin@admin.com';`

## 4) اضبطي متغيّرات التطبيق على Coolify (مورد التطبيق، لا Supabase)
مورد التطبيق → **Environment Variables**:
```
NEXT_PUBLIC_SUPABASE_URL       = <دومين Kong العام>
NEXT_PUBLIC_SUPABASE_ANON_KEY  = <anon key ذاتي الاستضافة>
SUPABASE_SERVICE_ROLE_KEY      = <service role key ذاتي الاستضافة>
SUPABASE_DB_URL                = postgresql://postgres:<pw>@<db-host>:5432/postgres
SETTINGS_ENCRYPTION_KEY        = <أبقيه كما هو من .env.local — مفتاح التطبيق نفسه>
NEXT_PUBLIC_BASE_URL           = <رابط التطبيق العام>
```
- ⚠️ فعّلي **Build Variable / Available at build** للمتغيّرين `NEXT_PUBLIC_*` (يُدمجان وقت البناء).
- (متغيّرات `TELEGRAM_*`/`BOT_*`/`SOLANA`/`JUPITER` غير لازمة لترافليون.)

## 5) أعيدي البناء والنشر
اضغطي **Redeploy** على مورد التطبيق (إعادة بناء ضرورية لأن `NEXT_PUBLIC_*` تُطبع في الـ bundle).

## 6) الدخول
`admin@admin.com` / `Traveliun#2026` → **غيّري كلمة المرور فورًا** (الحساب ← تغيير كلمة المرور)؛ فهي مكشوفة في المستودع العام.

---

## أخطاء شائعة
- **`NEXT_PUBLIC_SUPABASE_URL` يجب أن يكون الدومين العام لـ Kong** (قابلًا للوصول من متصفّح المستخدم) — لا مضيف داخلي في Docker.
- **مفاتيح لا تعمل**: تأكّدي أن anon/service مأخوذة من نفس نسخة Supabase ذاتية الاستضافة (لا من السحابة).
- **رسائل بريد المصادقة**: تسجيل موظفين جدد ذاتيًا قد يحتاج **SMTP** في إعداد GoTrue؛ لكن دخول الأدمن/الموظفين المبذورين لا يحتاجه.
- **Storage** (رفع ملفات الدليل): يتطلّب خدمة Storage تعمل (موجودة في الحزمة).
- **الأمان**: كل المفاتيح تُضبط كـ **Secrets** في Coolify — لا في المستودع.

> بديل أبسط وأكثر موثوقية: إبقاء Supabase السحابي (rpuxdg) وضبط متغيّراته فقط — بلا استضافة ذاتية. الاستضافة الذاتية تمنحك ملكية القاعدة لكن بعبء تشغيلي أكبر (7 خدمات + نسخ احتياطي عليك).
