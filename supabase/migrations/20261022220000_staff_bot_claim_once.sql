-- «تنبيهاتي»: a conversation is never announced twice in a row to the same
-- employee (seen 2026-10-22 on conversation 40407: the webhook announced it to
-- «رشا» at 12:45:18, a moment of «no assignee» came in between, and the
-- sweep announced it again at 12:46:37).
--
-- The state still follows every change. Only the announcement is held back when
-- the last one for this conversation went to the same agent. A real transfer
-- back (A → B → A) is announced again, because the last announcement was B's.

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
  if (select a.agent_id from staff_bot_assignments a where a.conversation_id = p_conversation order by a.id desc limit 1) is not distinct from p_agent then
    return false;
  end if;
  insert into staff_bot_assignments (conversation_id, agent_id, source) values (p_conversation, p_agent, p_source);
  return true;
end
$$;
revoke all on function public.staff_bot_claim_assignment(integer, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.staff_bot_claim_assignment(integer, integer, text, boolean) to service_role;
