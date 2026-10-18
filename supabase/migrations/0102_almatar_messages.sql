-- «مخاطبة المورد» — Almatar writes to Traveliun, and we answer, inside the
-- portal (the owner, 2026-10-18). One thread per partner company; a message may
-- name the request it is about. Closed to every session like the other almatar_*
-- tables: the app writes through the service role after checking who is asking.
create table if not exists public.almatar_messages (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.booking_partners (id) on delete cascade,
  -- partner = Almatar wrote it; staff = one of us
  sender text not null check (sender in ('partner', 'staff')),
  body text not null check (length(btrim(body)) between 1 and 2000),
  request_ref text,
  author_user uuid,
  author_employee uuid references public.employees (id) on delete set null,
  -- when the OTHER side opened it
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists almatar_messages_partner_idx on public.almatar_messages (partner_id, created_at);

alter table public.almatar_messages enable row level security;

notify pgrst, 'reload schema';
