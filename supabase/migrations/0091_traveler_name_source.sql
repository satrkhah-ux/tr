-- ============================================================================
-- 0091 — «اسم الواتساب ليس اسم الجواز» (the owner, 2026-10-18; audited on AD-2-3599)
--
-- Traveller 1 was seeded with the client's CONTACT name — the WhatsApp name
-- Teletel gave the customer («al 3r18y») — and reading the passport did not
-- replace it, so the hotel voucher, the arrival sign, the driver's programme and
-- the supplier's «الأسماء كما في الجواز» all printed it. Now nobody is seeded with
-- a name (travelers.ts planTravelers), and a passport read names the traveller
-- unless a person typed the name (travelers.ts savedName). This column is what
-- tells the two apart:
--   seed     — planned from the offer (unnamed now; the contact name on older rows)
--   passport — read off the passport (MRZ: a staff photo, a client upload accepted)
--   manual   — typed by a person: a passport read asks before replacing it
--                («استبدال بالاسم من الجواز»)
--
-- display_name holds the name as in the passport, in clear — as it already did
-- once a companion's passport was read: it is what the voucher prints. The number
-- stays encrypted. The client's contact name stays on customers.arabic_name, for
-- greetings only.
--
-- The code writes name_source as a best-effort update after the save and reads
-- it with select('*'), so it is safe to deploy before this is applied — until
-- then every existing name counts as typed: asked about, never overwritten.
-- The names already printed from a contact name, with a passport on file, are
-- put right by scripts/backfill-passport-names-2026-10-18.mjs (after this).
--
-- Idempotent. Rollback:
--   alter table public.operation_travelers drop column if exists name_source;
-- ============================================================================

alter table public.operation_travelers add column if not exists name_source text;

-- The rows already there, only those not yet marked (a re-run changes nothing).
-- A name equal to the case's client name was seeded from it; an empty one was
-- never named; any other was written by a person or off a passport — counted as
-- typed, so a passport read asks before replacing it.
update public.operation_travelers t
   set name_source = 'seed'
  from public.operations o
  join public.offers f on f.id = o.offer_id
  left join public.customers c on c.id = f.customer_id
 where t.operation_id = o.id
   and t.name_source is null
   and (
     btrim(t.display_name) = ''
     or lower(regexp_replace(btrim(t.display_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(coalesce(c.arabic_name, '')), '\s+', ' ', 'g'))
   );
update public.operation_travelers set name_source = 'manual' where name_source is null and btrim(display_name) <> '';
update public.operation_travelers set name_source = 'seed' where name_source is null;

alter table public.operation_travelers alter column name_source set default 'seed';
alter table public.operation_travelers alter column name_source set not null;
alter table public.operation_travelers drop constraint if exists operation_travelers_name_source_check;
alter table public.operation_travelers
  add constraint operation_travelers_name_source_check
  check (name_source in ('seed', 'passport', 'manual'));
