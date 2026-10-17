-- ============================================================================
-- 0087 — «العملاء»: every client conversation, open to every employee
--
-- The owner's order (2026-10-17), phase one: the company logs each WhatsApp
-- conversation in a Google Sheet (phone, inquiry, country, the employee who
-- received it, who it was handed to, open/closed…). That sheet is pulled into
-- this table, and staff can log a conversation here directly too. A Basic file
-- started from a conversation is tied to it (draft_id), so the conversation is
-- classified by the programme made for it («ماليزيا»).
--
--  · source = 'sheet' rows carry sheet_key (phone|inquiry|country|receiver —
--    the sheet has no row id) and sheet_raw: the cells as last pulled. A pull
--    only overwrites a field whose CELL changed since then, so an edit made
--    here is not undone by an unchanged sheet.
--  · received_by_name / assigned_to_name keep the sheet's own wording when no
--    employee matches it.
--
-- RLS: any active employee reads, logs and updates (is_staff, 0034); partners
-- never. No delete: a closed conversation is closed, not erased. Idempotent.
-- ============================================================================

create table if not exists public.client_leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  name text,
  customer_id uuid references public.customers (id) on delete set null,
  inquiry text,
  destination text,
  received_by uuid references public.employees (id) on delete set null,
  received_by_name text,
  assigned_to uuid references public.employees (id) on delete set null,
  assigned_to_name text,
  sent_status text,
  done_text text,
  status text not null default 'open' check (status in ('open', 'closed')),
  next_action text,
  result text,
  draft_id uuid references public.offer_drafts (id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'sheet')),
  sheet_key text unique,
  sheet_raw jsonb,
  created_by uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_leads_phone_idx on public.client_leads (phone);
create index if not exists client_leads_created_idx on public.client_leads (created_at desc);

alter table public.client_leads enable row level security;

drop policy if exists client_leads_staff_read on public.client_leads;
create policy client_leads_staff_read on public.client_leads
  for select to authenticated using (public.is_staff());

drop policy if exists client_leads_staff_insert on public.client_leads;
create policy client_leads_staff_insert on public.client_leads
  for insert to authenticated with check (public.is_staff());

drop policy if exists client_leads_staff_update on public.client_leads;
create policy client_leads_staff_update on public.client_leads
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update on public.client_leads to authenticated;
