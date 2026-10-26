-- «ملفات التأشيرات» (the owner, 2026-10-26: «اضف قسم التأشيرات وكذلك امكانية عمل ملف خاص بالتأشيرات — يختار بيانات
-- المسافر يسحبونه من تليتيل والدولة والعدد وتاريخ التقديم والخدمات المقدمة ثم ماذا ارفق ومتى الرد ومتابعة كاملة
-- لقسم التأشيرات ولوحة كاملة للطلبات التي جهزت وقيد التنفيذ والعملاء لم يسددوا»).
--
-- Three tables: the file, its payments and its timeline. Closed to sessions (RLS on, no policy, no grant — the
-- finance_book_versions posture): only the server, after visas.work / visas.manage (src/lib/data/visa-files.ts),
-- reads or writes them with the service role. The travellers' passport numbers live ENCRYPTED inside
-- visa_files.travelers (the operation_travelers way, SETTINGS_ENCRYPTION_KEY); the papers themselves go to the
-- private «visas» bucket (0061), never a public one.
--
-- visa_files.paid is a copy the board reads without a join. It is kept right by the trigger below — every
-- insert, update and delete of a payment recomputes it from the payments — so it cannot drift whatever writes.
-- visa_files.rev is the optimistic lock: documents/travellers/services are jsonb edited by several colleagues, a
-- write names the rev it read and is refused when somebody saved in between (the action retries on the new row).
--
-- Additive and idempotent. NOT applied by the session that wrote it: the owner approves it first.

create table if not exists public.visa_files (
  id uuid primary key default gen_random_uuid(),
  -- «VF-26-0001»: VF-<year>-<number>, made by the action (next after the year's highest, retried on a clash)
  serial text not null unique check (serial ~ '^VF-[0-9]{2}-[0-9]{4,}$'),
  status text not null default 'new'
    check (status in ('new', 'collecting', 'ready', 'submitted', 'approved', 'rejected', 'delivered', 'cancelled')),
  country text not null,
  country_id uuid references public.countries (id) on delete set null,
  -- the catalogue row it follows; its requirements became the expected documents
  visa_catalog_id uuid references public.visas (id) on delete set null,
  visa_type text,
  applicants int not null default 1 check (applicants between 1 and 50),
  client_name text not null,
  client_phone text,
  -- the Teletel conversation the client came from (a client may have several files: not unique)
  conversation_id bigint,
  contact_id bigint,
  lead_id uuid references public.client_leads (id) on delete set null,
  assigned_to uuid references public.employees (id) on delete set null,
  -- [{id, fullName, passportEnc, passportLast4, nationality, birthDate, passportExpiry, result, visaNo, note}]
  travelers jsonb not null default '[]'::jsonb check (jsonb_typeof(travelers) = 'array'),
  -- [{id, kind, label, travelerId, path, fileName, required, receivedAt, submittedAt, fromMessageId}]
  documents jsonb not null default '[]'::jsonb check (jsonb_typeof(documents) = 'array'),
  -- [{key, label, price, done}]
  services jsonb not null default '[]'::jsonb check (jsonb_typeof(services) = 'array'),
  applied_at timestamptz,
  appointment_at timestamptz,
  expected_reply_at timestamptz,
  replied_at timestamptz,
  fee_service numeric(12, 2) not null default 0 check (fee_service >= 0),
  fee_embassy numeric(12, 2) not null default 0 check (fee_embassy >= 0),
  currency text not null default 'SAR',
  paid numeric(12, 2) not null default 0 check (paid >= 0),
  next_action text,
  next_action_at timestamptz,
  note text,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rev integer not null default 0
);

create index if not exists visa_files_status_idx on public.visa_files (status);
create index if not exists visa_files_assigned_idx on public.visa_files (assigned_to);
create index if not exists visa_files_conversation_idx on public.visa_files (conversation_id);
create index if not exists visa_files_expected_reply_idx on public.visa_files (expected_reply_at);
create index if not exists visa_files_next_action_idx on public.visa_files (next_action_at);

create table if not exists public.visa_file_payments (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.visa_files (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  method text,
  note text,
  paid_at timestamptz not null default now(),
  "by" uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists visa_file_payments_file_idx on public.visa_file_payments (file_id);

create table if not exists public.visa_file_events (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.visa_files (id) on delete cascade,
  at timestamptz not null default now(),
  "by" uuid references public.employees (id) on delete set null,
  kind text not null check (kind in ('created', 'status', 'note', 'payment', 'document', 'contact', 'edit')),
  text text not null
);
create index if not exists visa_file_events_file_idx on public.visa_file_events (file_id, at desc);

-- paid = the sum of the payments, always
create or replace function public.visa_file_recompute_paid(p_file uuid) returns void
language sql
security definer
set search_path = public
as $$
  update public.visa_files
     set paid = coalesce((select sum(amount) from public.visa_file_payments where file_id = p_file), 0),
         updated_at = now()
   where id = p_file;
$$;

create or replace function public.visa_file_payments_sync() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.visa_file_recompute_paid(old.file_id);
    return old;
  end if;
  perform public.visa_file_recompute_paid(new.file_id);
  if tg_op = 'UPDATE' and old.file_id <> new.file_id then
    perform public.visa_file_recompute_paid(old.file_id);
  end if;
  return new;
end;
$$;

drop trigger if exists visa_file_payments_paid on public.visa_file_payments;
create trigger visa_file_payments_paid
  after insert or update or delete on public.visa_file_payments
  for each row execute function public.visa_file_payments_sync();

-- closed to sessions
alter table public.visa_files enable row level security;
alter table public.visa_file_payments enable row level security;
alter table public.visa_file_events enable row level security;
revoke all on public.visa_files from anon, authenticated;
revoke all on public.visa_file_payments from anon, authenticated;
revoke all on public.visa_file_events from anon, authenticated;
revoke all on function public.visa_file_recompute_paid(uuid) from public, anon, authenticated;
revoke all on function public.visa_file_payments_sync() from public, anon, authenticated;

-- «الربط الخارجي»: what the visa files use of the connections already registered (no new connection)
update public.integrations
set used_by = concat_ws(E'\n', nullif(used_by, ''), 'ملفات التأشيرات: البحث في المحادثات وسحب بيانات العميل ومرفقاته، وملاحظة داخلية عند فتح الملف'),
    updated_at = now()
where name = 'Teletel (Chatwoot)' and coalesce(used_by, '') not like '%ملفات التأشيرات%';
update public.integrations
set used_by = concat_ws(E'\n', nullif(used_by, ''), 'ملفات التأشيرات: قراءة صورة الجواز (MRZ) لتعبئة بيانات المسافر بعد مراجعة الموظف'),
    updated_at = now()
where name = 'OpenAI' and coalesce(used_by, '') not like '%ملفات التأشيرات%';

notify pgrst, 'reload schema';

-- ROLLBACK (manual; the papers in the «visas» bucket under visa-files/ are removed separately):
-- drop table if exists public.visa_file_events, public.visa_file_payments, public.visa_files;
-- drop function if exists public.visa_file_payments_sync(), public.visa_file_recompute_paid(uuid);
