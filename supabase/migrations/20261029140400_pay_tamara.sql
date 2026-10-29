-- «ادفع بتمارا — قسّمها» (the owner, 2026-10-29): Tamara's entry on «الربط الخارجي» names its new user — the
-- public page /pay/<serial>?m=tamara and the client PDF's Tamara button. Data only, idempotent (the guard).
update public.integrations
   set used_by = 'روابط التقسيط في العمليات وبيسك، وزر «ادفع بتمارا» في PDF العميل وصفحته (الصفحة العامة /pay/<الرقم>?m=tamara — src/lib/payments/pay-now.ts)',
       notes = coalesce(notes, '') || ' · /pay/<الرقم>?m=tamara: الضغط ينشئ جلسة دفع تمارا بالمتبقي (آخر نسخة ناقص المدفوع) وتعود إلى /pay/<الرقم>/done التي لا تسجّل شيئاً؛ مهمة الـ10 دقائق تسجّل المعتمد/المحصّل فقط'
 where name = 'تمارا Tamara'
   and coalesce(notes, '') not like '%m=tamara%';

-- ROLLBACK (manual):
--   update public.integrations set used_by = 'روابط التقسيط في العمليات (src/lib/data/payment-links.ts، PaymentLinkPanel)',
--     notes = split_part(notes, ' · /pay/', 1) where name = 'تمارا Tamara';
