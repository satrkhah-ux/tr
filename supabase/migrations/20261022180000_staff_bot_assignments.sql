-- «تنبيهاتي» stage b (the owner, 2026-10-22): each conversation assigned to an
-- employee in Teletel is announced to them once.
--
-- staff_bot_conversations — who each conversation is with, as last seen. It
-- comes from Teletel's webhook (conversation_created / conversation_updated)
-- and from the minute sweep over the open conversations, which catches
-- whatever the webhook missed. A row is never deleted, so a conversation that
-- reopens with the same agent is not announced again.
--
-- staff_bot_assignments — every announced assignment. It is the dedupe's
-- record and the source of «أُسندت إليك اليوم».
--
-- staff_bot_claim_assignment() moves the state and logs it in one statement.
-- The webhook and the sweep may see the same change in the same second, and
-- only one of them gets true.

create table if not exists public.staff_bot_conversations (
  conversation_id integer primary key,
  assignee_id integer,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_bot_assignments (
  id bigint generated always as identity primary key,
  conversation_id integer not null,
  agent_id integer not null,
  source text not null check (source in ('webhook', 'sweep')),
  created_at timestamptz not null default now()
);
create index if not exists staff_bot_assignments_agent_day on public.staff_bot_assignments (agent_id, created_at desc);

alter table public.staff_bot_conversations enable row level security;
alter table public.staff_bot_assignments enable row level security;
revoke all on public.staff_bot_conversations, public.staff_bot_assignments from anon, authenticated;
grant select, insert, update, delete on public.staff_bot_conversations, public.staff_bot_assignments to service_role;

-- true = this call moved the conversation to p_agent and logged it: announce it.
-- p_announce false moves the state silently (a baseline, an unassignment, an old
-- conversation reopening).
create or replace function public.staff_bot_claim_assignment(p_conversation integer, p_agent integer, p_source text, p_announce boolean)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  insert into staff_bot_conversations as s (conversation_id, assignee_id)
  values (p_conversation, p_agent)
  on conflict (conversation_id) do update set assignee_id = excluded.assignee_id, updated_at = now()
    where s.assignee_id is distinct from excluded.assignee_id;
  if not found or p_agent is null or not p_announce then
    return false;
  end if;
  insert into staff_bot_assignments (conversation_id, agent_id, source) values (p_conversation, p_agent, p_source);
  return true;
end
$$;
revoke all on function public.staff_bot_claim_assignment(integer, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.staff_bot_claim_assignment(integer, integer, text, boolean) to service_role;

insert into public.integrations (name, kind, used_by, secret_ref, account, check_key, notes)
select
  'تنبيهاتي — فحص التحويلات كل دقيقة',
  'cron',
  'يلتقط كل محادثة أُسندت لموظف في تيلي تيل ولم يصل إشعارها عبر الـ webhook، ويتابع حالة وصول الردود',
  'ADMIN_API_SECRET',
  'vps-new / ضمن مهمة الدقيقة /api/murad/run',
  'job_staff_tick',
  'لا سطر crontab خاص به: يعمل داخل /api/murad/run بعد مزامنة المتابعة'
where not exists (select 1 from public.integrations where check_key = 'job_staff_tick');
