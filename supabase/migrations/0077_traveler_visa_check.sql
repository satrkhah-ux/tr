-- Owner order 8 — a traveler's visa by NATIONALITY × destination.
--
-- `countries.visa_required` (0011) was written for Saudi passports, yet every
-- traveler was seeded «غير مطلوبة» from it — an Iraqi and a Syrian to Indonesia
-- included. operation_travelers.visa_status gains 'check' («يحتاج تحقق»): the
-- nationality is not Saudi and nobody has looked yet. It holds «جاهز للسفر»
-- like 'required' until an employee picks the real status.
--
-- The code (src/lib/operations/travelers.ts visaFor) writes 'check' only as a
-- best-effort update after a passport save, so it is safe to deploy before this
-- is applied — it just cannot mark anyone «يحتاج تحقق» until it is.
--
-- Idempotent. Rollback:
--   update public.operation_travelers set visa_status = 'not_required' where visa_status = 'check';
--   alter table public.operation_travelers drop constraint if exists operation_travelers_visa_status_check;
--   alter table public.operation_travelers add constraint operation_travelers_visa_status_check
--     check (visa_status in ('not_required', 'required', 'submitted', 'issued'));

alter table public.operation_travelers drop constraint if exists operation_travelers_visa_status_check;
alter table public.operation_travelers
  add constraint operation_travelers_visa_status_check
  check (visa_status in ('check', 'not_required', 'required', 'submitted', 'issued'));

-- The travelers already read as non-Saudi and still on the blanket default (on
-- 2026-10-15 exactly two: the Indonesia case AD-4-8573-20261015, IRQ and SYR;
-- the third non-Saudi on file, an IRQ to Malaysia, is 'issued' and stays).
-- Only 'not_required' moves — a visa required, submitted or issued is someone's work.
update public.operation_travelers
   set visa_status = 'check', updated_at = now()
 where visa_status = 'not_required'
   and nullif(btrim(nationality), '') is not null
   and upper(btrim(nationality)) <> 'SAU';
