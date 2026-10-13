-- Operations order 11 (suggestion 6): the client uploads each traveller's
-- passport photo from the trip link (/trip/<token>).
--
--  · operation_passport_submissions — one row per upload, PENDING until staff
--    accept or reject it. An upload never writes the traveller's verified
--    passport (operation_travelers.passport_encrypted): accepting goes through
--    the existing encrypted save path behind operations.write, with its audit.
--  · parsed_encrypted — what the MRZ reader made of the photo (number, name,
--    nationality, dates), AES-256-GCM like the traveller's own blob; null when
--    the photo was not read (no OpenAI key, a PDF, an unreadable page, or no
--    vault key). Cleared once the submission is decided.
--  · scan_path — the photo in the PRIVATE `passports` bucket (0024). Cleared
--    (and the file removed) on reject or when a newer upload supersedes it; on
--    accept the same object becomes the traveller's passport_image_path.
--  · The daily cap is a COUNT over this table (created_at, last 24 h per
--    traveller) — no separate counter to drift.
--
-- RLS ENABLED, NO POLICY — the operation_travelers posture (0024): passport
-- data is reached only through the service role, behind the trip token for the
-- client and behind operations.write / operations.passport for staff. A staff
-- policy would hand every signed-in employee the scan paths of every client.
--
-- Additive only; idempotent, safe to re-run. Apply BEFORE deploying the code
-- that reads it (the trip page shows the upload only when this table answers).

create table if not exists public.operation_passport_submissions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  traveler_id uuid not null references public.operation_travelers (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'superseded')),
  scan_path text,
  parsed_encrypted text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists operation_passport_submissions_traveler_idx
  on public.operation_passport_submissions (traveler_id, created_at desc);
create index if not exists operation_passport_submissions_operation_idx
  on public.operation_passport_submissions (operation_id, status);

alter table public.operation_passport_submissions enable row level security;
-- re-lock if a permissive policy was ever added by hand
drop policy if exists operation_passport_submissions_staff on public.operation_passport_submissions;

notify pgrst, 'reload schema';
