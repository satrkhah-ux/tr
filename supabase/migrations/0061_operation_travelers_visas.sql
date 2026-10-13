-- Ops order 5 — «المسافرون والجوازات من العرض، والتأشيرات».
--
-- operation_travelers gains what the case needs WITHOUT a decrypt:
--   • birth_date   — the age check on the travel day (a child sold at 9 must be 9)
--   • age          — the age the offer was SOLD with, kept to compare against it
--   • nationality  — printed on the hotel voucher; it was only inside the
--                    encrypted blob, so every voucher printed «—»
--   • visa_status / visa_file_path — per traveler, feeding «جاهز للسفر»
-- None of these is the passport number or name; those stay in passport_encrypted.
--
-- The table KEEPS its 0024 posture — RLS on, NO policy, service role behind the
-- operations.* gates only. That is stricter than is_staff() and stays so: this is
-- passport data. The new `visas` bucket copies the `passports` one (no policy; a
-- storage policy could only test bucket_id), because a visa carries the number.
--
-- operations.travelers_seeded_at: the case seeds its travelers from the offer once,
-- on first open — the claim on this column is what makes two tabs seed once and
-- keeps a case whose travelers were deleted on purpose from refilling.
--
-- Additive and idempotent. The code reads these columns, so apply BEFORE deploying it.

alter table public.operation_travelers
  add column if not exists birth_date date,
  add column if not exists age smallint,
  add column if not exists nationality text,
  add column if not exists visa_status text not null default 'not_required',
  add column if not exists visa_file_path text;

alter table public.operation_travelers drop constraint if exists operation_travelers_age_check;
alter table public.operation_travelers
  add constraint operation_travelers_age_check check (age is null or age between 0 and 120);

alter table public.operation_travelers drop constraint if exists operation_travelers_visa_status_check;
alter table public.operation_travelers
  add constraint operation_travelers_visa_status_check
  check (visa_status in ('not_required', 'required', 'submitted', 'issued'));

-- re-lock, as 0024 does, in case a permissive policy was ever added by hand
alter table public.operation_travelers enable row level security;
drop policy if exists operation_travelers_authenticated_all on public.operation_travelers;

alter table public.operations add column if not exists travelers_seeded_at timestamptz;

-- ---------- private storage bucket for visas ----------
insert into storage.buckets (id, name, public)
values ('visas', 'visas', false)
on conflict (id) do nothing;

-- NO policy, deliberately — the `passports` reasoning (0024): signed 5-minute URLs
-- from the service role, gated on operations.passport and written to audit_logs.
drop policy if exists visas_rw on storage.objects;
