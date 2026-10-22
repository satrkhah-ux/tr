-- «مؤكد — مسافر قريباً» (order 2, stage 4 — the user, 2026-10-22: «نعم، ابنِ تصنيف «مؤكد — مسافر قريباً»
-- بالربط عبر رقم الجوال، ومن ليس له ملف يتبع القواعد العادية»). A confirmed traveller's conversation is closed
-- under that class, linked to its trip: if the client writes before the return date + 3 days it goes straight
-- back to the trip's owner, never as a new request; after that, the normal rules.
--
-- The trip is an operations file, or one entered by hand in «نظام البكجات ← المؤكدون خارج النظام» (the user,
-- 2026-10-22: «اضف امكانية ادخال ربط لعميل قبل النظام… رقمه تاريخ السفر عدد الايام الوجهة الحالة و المبلغ
-- المدفوع ماذا تم تأكديه… غير مرتبط مع البكجات»): no offer, no file — just enough to know the client travels.

create table if not exists public.external_trips (
  id uuid primary key default gen_random_uuid(),
  -- normalized: 9665XXXXXXXX
  phone text not null,
  travel_start date not null,
  days integer not null check (days between 1 and 365),
  destination text not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'paid_partial', 'paid_full', 'cancelled')),
  paid_amount numeric(12, 2) check (paid_amount is null or paid_amount >= 0),
  -- what was confirmed: طيران، فندق، مواصلات، جولات، تأشيرة، تأمين
  confirmed_items text[] not null default '{}',
  -- whoever entered it: the conversation comes back to them
  employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists external_trips_phone_idx on public.external_trips (phone);
create index if not exists external_trips_start_idx on public.external_trips (travel_start desc);

-- read by staff; written by the server only (src/lib/data/external-trips.ts, offers.write checked there)
alter table public.external_trips enable row level security;
drop policy if exists external_trips_staff_read on public.external_trips;
create policy external_trips_staff_read on public.external_trips
  for select to authenticated using (public.is_staff());
grant select on public.external_trips to authenticated;

alter table public.conversation_closures add column if not exists travel_operation_id uuid references public.operations(id) on delete set null;
alter table public.conversation_closures add column if not exists travel_external_id uuid references public.external_trips(id) on delete set null;
alter table public.conversation_closures add column if not exists travel_until date;

alter table public.conversation_closures drop constraint if exists conversation_closures_reopen_action_check;
alter table public.conversation_closures add constraint conversation_closures_reopen_action_check
  check (reopen_action in ('returned_to_employee', 'returned_to_file_owner', 'unassigned', 'kept'));

comment on column public.conversation_closures.travel_operation_id is 'closed as «مؤكد — مسافر قريباً»: the operations file the client travels on';
comment on column public.conversation_closures.travel_external_id is 'closed as «مؤكد — مسافر قريباً»: the trip entered by hand (external_trips)';
comment on column public.conversation_closures.travel_until is 'the return date + 3 days: a client writing until then goes back to the trip''s owner';
