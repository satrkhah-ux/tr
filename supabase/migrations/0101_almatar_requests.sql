-- «المطار»: one booking REQUEST holds several services (the owner, 2026-10-18:
-- «استقبال، توديع، استقبال وتوديع، جولات، تنقلات، برنامج من إلى … ليس فقط
-- خدمة واحدة»). Each service stays its own almatar_bookings row — operations
-- confirm, refuse and voucher each line (its own driver) — and the rows taken
-- together share request_ref. Older single bookings keep a null request_ref.
alter table public.almatar_bookings
  add column if not exists request_ref text,
  -- what Almatar picked: arrival / departure / both / tours / transfers / program
  add column if not exists request_kind text;

alter table public.almatar_bookings
  drop constraint if exists almatar_bookings_request_kind_check,
  add constraint almatar_bookings_request_kind_check
    check (request_kind is null or request_kind in ('arrival', 'departure', 'both', 'tours', 'transfers', 'program'));

create index if not exists almatar_bookings_request_idx on public.almatar_bookings (request_ref) where request_ref is not null;

notify pgrst, 'reload schema';
