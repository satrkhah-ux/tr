-- «أرشيف القرارات الإدارية» + «📜 إصدار قرار» (the owner, 2026-10-29: «اريد ارشيف القرارات الإدارية يكون موجود ونرجع
-- له: الموظف متى وقّع وعلى ماذا استلم خطاب. وأضف في البوت إصدار قرار … يحمل هوية ترافليون، ويُرقَّم، ويُصدر بعدد»).
--
-- admin_decisions            one formal decision: its kind, title, the text the issuer wrote (original_text) and the one
--                            printed (final_text), whom it was addressed to (audience: what the issuer picked, kept as
--                            picked) and its serial «ق-2026-0001», given only when it is issued — a draft takes no number.
-- admin_decision_recipients  the exact employees the audience meant AT ISSUE TIME (a role, a department or «الجميع»
--                            expanded then, never re-read), each with when the bot delivered it, when they opened it and
--                            «استلمت» — their acknowledgement, the signature — once.
-- admin_decision_counters    the last number of each year. admin_decision_issue() takes the next one under the counter
--                            row's lock, so two managers issuing at the same moment never share a number (and the unique
--                            serial is the backstop).
--
-- staff_letters (the sales letters 1/2) stay where they are; the archive reads both.
-- Closed tables like the rest of ours: RLS on, no policies, only the service role behind the checked server code.
--
-- NOT applied by code: the coordinator applies it (backup first). Dry run: BEGIN; \i file; ROLLBACK.

create table if not exists public.admin_decisions (
  id uuid primary key default gen_random_uuid(),
  serial text unique,
  year int,
  seq int,
  status text not null default 'draft' check (status in ('draft', 'issued')),
  kind text not null check (char_length(kind) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  original_text text not null default '' check (char_length(original_text) <= 6000),
  final_text text not null default '' check (char_length(final_text) <= 6000),
  -- {"all":true} | {"employees":[uuid…],"roles":[uuid…],"teams":[int…]}
  audience jsonb not null default '{}'::jsonb,
  -- «قسم المبيعات · أحمد يوسف», printed on the document
  audience_label text not null default '' check (char_length(audience_label) <= 400),
  -- the AI wording was used (the issuer still approved it)
  ai_worded boolean not null default false,
  created_by uuid references public.employees (id) on delete set null,
  issued_by uuid references public.employees (id) on delete set null,
  issued_by_name text,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  unique (year, seq),
  check ((status = 'issued') = (serial is not null and issued_at is not null))
);
create index if not exists admin_decisions_issued on public.admin_decisions (issued_at desc) where status = 'issued';

create table if not exists public.admin_decision_recipients (
  decision_id uuid not null references public.admin_decisions (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  -- the name as it was when the decision was issued
  name text not null,
  chat_id bigint,
  message_id bigint,
  delivered_at timestamptz,
  opened_at timestamptz,
  acknowledged_at timestamptz,
  ack_via text check (ack_via in ('bot', 'web')),
  reminded_at timestamptz,
  reminders int not null default 0,
  primary key (decision_id, employee_id)
);
create index if not exists admin_decision_recipients_employee on public.admin_decision_recipients (employee_id);
create index if not exists admin_decision_recipients_pending on public.admin_decision_recipients (decision_id) where acknowledged_at is null;

create table if not exists public.admin_decision_counters (
  year int primary key,
  last int not null default 0
);

-- the next number of the year, the draft turned issued and its recipients written — one transaction.
-- Null when the draft is gone or already issued (a double tap issues once). p_recipients: [{"id":uuid,"name":text}…]
create or replace function public.admin_decision_issue(p_id uuid, p_by uuid, p_by_name text, p_recipients jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  y int := extract(year from (now() at time zone 'Asia/Riyadh'))::int;
  n int;
  s text;
begin
  perform 1 from public.admin_decisions where id = p_id and status = 'draft' for update;
  if not found then
    return null;
  end if;
  if jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0 then
    raise exception 'admin_decision_issue: no recipients';
  end if;
  insert into public.admin_decision_counters as c (year, last) values (y, 1)
    on conflict (year) do update set last = c.last + 1
    returning last into n;
  s := 'ق-' || y || '-' || lpad(n::text, 4, '0');
  update public.admin_decisions
     set status = 'issued', year = y, seq = n, serial = s, issued_at = now(), issued_by = p_by, issued_by_name = p_by_name
   where id = p_id;
  insert into public.admin_decision_recipients (decision_id, employee_id, name)
    select p_id, (r ->> 'id')::uuid, coalesce(nullif(r ->> 'name', ''), '—')
      from jsonb_array_elements(p_recipients) r
    on conflict do nothing;
  return s;
end;
$$;

-- staff_bot_pending — what a manager's next text is for: the decision's text («📜 إصدار قرار») joins the others.
alter table public.staff_bot_pending drop constraint if exists staff_bot_pending_kind_check;
alter table public.staff_bot_pending add constraint staff_bot_pending_kind_check check (kind in ('broadcast', 'alert', 'decision', 'admin_decision'));

alter table public.admin_decisions enable row level security;
alter table public.admin_decision_recipients enable row level security;
alter table public.admin_decision_counters enable row level security;
revoke all on public.admin_decisions, public.admin_decision_recipients, public.admin_decision_counters from anon, authenticated;
grant select, insert, update, delete on public.admin_decisions, public.admin_decision_recipients, public.admin_decision_counters to service_role;
revoke all on function public.admin_decision_issue(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_decision_issue(uuid, uuid, text, jsonb) to service_role;
