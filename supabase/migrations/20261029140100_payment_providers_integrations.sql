-- DRAFT — do not apply; the coordinator applies after the owner's yes.
--
-- «الربط الخارجي»: the two payment gateways behind «رابط ماي فاتورة» / «رابط تمارا»
-- (src/lib/providers/myfatoorah.ts, tamara.ts). Env var NAMES only — never a value.
-- Without the key/token (or with PAYMENTS_MOCK=1) both run in mock mode.

insert into public.integrations (name, kind, used_by, secret_ref, account, check_key, notes)
values
  (
    'ماي فاتورة MyFatoorah',
    'api',
    'روابط السداد في العمليات (src/lib/data/payment-links.ts، PaymentLinkPanel)',
    'MYFATOORAH_API_KEY / MYFATOORAH_BASE_URL',
    'حساب ماي فاتورة السعودية — يحدده المالك',
    'myfatoorah',
    'الافتراضي خادم الاختبار apitest.myfatoorah.com؛ الحي في السعودية https://api-sa.myfatoorah.com مع مفتاحه. PAYMENTS_MOCK=1 أو غياب المفتاح = وضع تجريبي'
  ),
  (
    'تمارا Tamara',
    'api',
    'روابط التقسيط في العمليات (src/lib/data/payment-links.ts، PaymentLinkPanel)',
    'TAMARA_API_TOKEN / TAMARA_BASE_URL',
    'حساب تمارا للتاجر — يحدده المالك',
    'tamara',
    'الافتراضي sandbox api-sandbox.tamara.co؛ الحي https://api.tamara.co مع رمزه. PAYMENTS_MOCK=1 أو غياب الرمز = وضع تجريبي'
  )
on conflict (name) do nothing;

-- ROLLBACK (manual):
--   delete from public.integrations where name in ('ماي فاتورة MyFatoorah', 'تمارا Tamara');
--
-- DRY RUN: begin; \i supabase/migrations/20261029140100_payment_providers_integrations.sql
--   then: select name, check_key from public.integrations where check_key in ('myfatoorah', 'tamara');  -- 2 rows
--   rollback;
