begin;
-- «المتابعة» follows OFFERS (the owner, 2026-10-23): a priced offer the client
-- went quiet after, by its seller, on a cadence of two hours, then days 1, 3, 7.
alter table public.sla_followups
  add column if not exists offer_id uuid references public.offers(id) on delete set null,
  add column if not exists offer_at timestamptz,
  add column if not exists offer_line text,
  add column if not exists destination text,
  add column if not exists step smallint check (step between 0 and 4),
  add column if not exists client_line text,
  add column if not exists client_waiting boolean not null default false,
  add column if not exists close_reason text;
create index if not exists followups_offer on public.sla_followups(offer_id) where offer_id is not null;

-- When step p_step falls due (rules.ts stepDue): hours after the offer, never
-- closer than 2 h (the first) or 20 h (the others) to the last interaction.
create function public.followup_step_due(p_step int,p_offer timestamptz,p_last timestamptz) returns timestamptz
language sql immutable set search_path=public as $$
  select greatest(p_offer + make_interval(hours => (array[2,24,72,168,192])[least(greatest(p_step,0),4)+1]),
                  p_last + make_interval(hours => case when p_step=0 then 2 else 20 end))
$$;
revoke all on function public.followup_step_due(int,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.followup_step_due(int,timestamptz,timestamptz) to service_role;

create or replace function public.followup_action(p_id uuid,p_actor uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  f sla_followups%rowtype; a followup_attempts%rowtype; manager boolean; team boolean;
  target uuid; due timestamptz; outcome_value text; next_stage text; request_id uuid; reason text; next_step smallint; sent boolean;
begin
  manager:=followup_employee_can(p_actor,'followups.manage') or followup_employee_can(p_actor,'dashboard.admin') or followup_employee_can(p_actor,'developer.access');
  team:=manager or followup_employee_can(p_actor,'followups.work');
  select * into f from sla_followups where id=p_id for update;
  if not found then return '{"ok":false,"error":"notFound"}'; end if;
  -- a seller works his own files without being on the follow-up team (the owner, 2026-10-23)
  if not team and f.assigned_to is distinct from p_actor then return '{"ok":false,"error":"forbidden"}'; end if;
  if p_action='claim' then
    if f.status<>'open' or f.assigned_to is not null or f.send_lock is not null then return '{"ok":false,"error":"claimed"}'; end if;
    update sla_followups set assigned_to=p_actor,assigned_by=p_actor,assigned_at=now(),stage=case when stage='new' then 'working' else stage end where id=p_id;
    insert into followup_attempts(followup_id,employee_id,kind,note) values(p_id,p_actor,'claim','استلام المتابعة');
    return '{"ok":true}';
  end if;
  if not manager and f.assigned_to is distinct from p_actor then return '{"ok":false,"error":"forbidden"}'; end if;
  if p_action in ('finish_send','finish_transfer') then
    request_id:=(p_data->>'requestId')::uuid;
    if f.send_lock is distinct from request_id then return '{"ok":false,"error":"conflict"}'; end if;
    if p_data->>'state' not in ('sent','uncertain','failed') then return '{"ok":false,"error":"invalid"}'; end if;
    sent:=p_data->>'state'='sent' and p_action='finish_send' and f.step is not null;
    -- an offer's message sent while its step was due does that step; the next is scheduled by itself
    next_step:=case when sent and f.next_followup_at<=now() then least(f.step+1,4) else f.step end;
    update followup_attempts set delivery_state=p_data->>'state',provider_message_id=(p_data->>'messageId')::bigint where id=request_id and followup_id=p_id;
    update sla_followups set send_lock=case when p_data->>'state'='uncertain' then request_id else null end,
      replied_at=case when p_data->>'state'='sent' then now() else replied_at end,
      first_followed_at=case when p_data->>'state'='sent' then coalesce(first_followed_at,now()) else first_followed_at end,
      step=next_step,
      next_followup_at=case when sent then followup_step_due(next_step,f.offer_at,now()) else next_followup_at end,
      client_waiting=case when p_data->>'state'='sent' then false else client_waiting end,
      stage=case when p_data->>'state'='sent' and p_action='finish_transfer' then 'transferred' when p_data->>'state'='sent' and last_client_at>(select created_at from followup_attempts where id=request_id) then case when assigned_to is null then 'new' else 'working' end when p_data->>'state'='sent' then 'waiting' else stage end,
      status=case when p_action='finish_transfer' and p_data->>'state'='sent' then 'done' else status end,
      outcome=case when p_action='finish_transfer' and p_data->>'state'='sent' then 'transferred' else outcome end,
      done_at=case when p_action='finish_transfer' and p_data->>'state'='sent' then now() else done_at end,
      done_by=case when p_action='finish_transfer' and p_data->>'state'='sent' then p_actor else done_by end
    where id=p_id;
    return '{"ok":true}';
  end if;
  if p_action='release_uncertain' then
    if not manager or length(trim(coalesce(p_data->>'note','')))<5 then return '{"ok":false,"error":"forbidden"}'; end if;
    select * into a from followup_attempts where id=f.send_lock;
    if not found or a.created_at>now()-interval '2 minutes' then return '{"ok":false,"error":"busy"}'; end if;
    update followup_attempts set delivery_state='failed' where id=a.id;
    insert into followup_attempts(followup_id,employee_id,kind,note) values(p_id,p_actor,'send_review',p_data->>'note');
    update sla_followups set send_lock=null where id=p_id;
    return '{"ok":true}';
  end if;
  if f.status<>'open' then return '{"ok":false,"error":"done"}'; end if;
  if p_action in ('reserve_send','reserve_transfer') then
    request_id:=(p_data->>'requestId')::uuid;
    select * into a from followup_attempts where id=request_id;
    if found then
      if a.followup_id<>p_id or a.employee_id<>p_actor then return '{"ok":false,"error":"forbidden"}'; end if;
      return jsonb_build_object('ok',true,'duplicate',true,'state',a.delivery_state);
    end if;
  end if;
  if f.send_lock is not null then return '{"ok":false,"error":"busy"}'; end if;
  if p_action='assign' then
    if not manager then return '{"ok":false,"error":"forbidden"}'; end if;
    target:=(p_data->>'employeeId')::uuid;
    if target is not null and not (followup_employee_can(target,'followups.work') or followup_employee_can(target,'followups.manage') or followup_employee_can(target,'dashboard.admin') or followup_employee_can(target,'developer.access') or followup_employee_can(target,'offers.write')) then return '{"ok":false,"error":"invalid"}'; end if;
    update sla_followups set assigned_to=target,assigned_by=p_actor,assigned_at=case when target is null then null else now() end,
      stage=case when target is null then 'new' when stage='new' then 'working' else stage end where id=p_id;
    insert into followup_attempts(followup_id,employee_id,kind,note) values(p_id,p_actor,'assign',coalesce(target::text,'إلغاء الإسناد'));
  elsif p_action in ('reserve_send','reserve_transfer') then
    if length(trim(coalesce(p_data->>'text','')))=0 or length(p_data->>'text')>4000 then return '{"ok":false,"error":"invalid"}'; end if;
    insert into followup_attempts(id,followup_id,employee_id,kind,note,delivery_state,target_team_id)
      values(request_id,p_id,p_actor,case when p_action='reserve_transfer' then 'transfer' else 'message' end,p_data->>'text','pending',(p_data->>'targetTeamId')::integer);
    update sla_followups set send_lock=request_id,last_attempt_at=now(),attempt_count=attempt_count+1 where id=p_id;
  elsif p_action='result' then
    outcome_value:=p_data->>'outcome';
    if outcome_value not in ('no_answer','interested','revise_offer','later','not_interested','not_completed','completed') then return '{"ok":false,"error":"invalid"}'; end if;
    due:=(p_data->>'dueAt')::timestamptz;
    if due is not null and due<=now() then return '{"ok":false,"error":"due"}'; end if;
    reason:=nullif(trim(coalesce(p_data->>'reason','')),'');
    if outcome_value in ('not_interested','not_completed') and reason is null and length(trim(coalesce(p_data->>'note','')))<1 then return '{"ok":false,"error":"reason"}'; end if;
    if outcome_value in ('not_interested','not_completed','completed') then
      due:=null; next_stage:='completed'; next_step:=f.step;
    else
      -- the step was done (a call, a message from the phone) unless another time was chosen («موعد آخر»)
      next_step:=case when due is null and f.step is not null and f.next_followup_at<=now() then least(f.step+1,4) else f.step end;
      next_stage:=case when due is not null then 'scheduled' else 'waiting' end;
      due:=coalesce(due,case when f.step is not null then followup_step_due(next_step,f.offer_at,now()) else now()+interval '1 day' end);
    end if;
    insert into followup_attempts(followup_id,employee_id,kind,outcome,note,due_at)
      values(p_id,p_actor,coalesce(p_data->>'channel','note'),outcome_value,left(concat_ws(' — ',reason,nullif(trim(p_data->>'note'),'')),2000),due);
    update sla_followups set outcome=outcome_value,stage=next_stage,next_followup_at=due,step=next_step,last_attempt_at=now(),
      first_followed_at=coalesce(first_followed_at,now()),attempt_count=attempt_count+1,client_waiting=false,
      close_reason=case when next_stage='completed' then coalesce(reason,case when outcome_value='completed' then 'حجز' end) else close_reason end,
      status=case when next_stage='completed' then 'done' else 'open' end,
      done_at=case when next_stage='completed' then now() else null end,
      done_by=case when next_stage='completed' then p_actor else null end,
      note=left(p_data->>'note',2000) where id=p_id;
  else return '{"ok":false,"error":"invalid"}';
  end if;
  return '{"ok":true}';
end $$;
revoke all on function public.followup_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.followup_action(uuid,uuid,text,jsonb) to service_role;

-- A client's message stops the cadence: the file goes back to its seller as «رد العميل».
drop function if exists public.followup_wake(bigint,timestamptz);
create function public.followup_wake(p_conversation bigint,p_at timestamptz,p_text text default null) returns void language plpgsql security invoker set search_path=public as $$
declare f sla_followups%rowtype;
begin
 select * into f from sla_followups where conversation_id=p_conversation and status='open' for update;
 if not found or p_at<=coalesce(f.last_client_at,f.created_at) then return; end if;
 update sla_followups set last_client_at=p_at,client_waiting=true,
 client_line=coalesce(nullif(left(trim(p_text),200),''),client_line),
 stage=case when stage in ('waiting','scheduled') then case when assigned_to is null then 'new' else 'working' end else stage end,
 next_followup_at=case when stage in ('waiting','scheduled') then null else next_followup_at end where id=f.id;
 insert into followup_attempts(followup_id,kind,note) values(f.id,'incoming','رد جديد من العميل');
end $$;
revoke all on function public.followup_wake(bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.followup_wake(bigint,timestamptz,text) to service_role;

-- A booking is the file's own offer confirmed, or the lead's Basic file's.
create or replace function public.followup_confirmed_bookings() returns table(followup_id uuid,serial text)
language sql stable security invoker set search_path=public as $$
  select distinct on(o.id) f.id,o.serial::text from sla_followups f
  left join client_leads l on l.teletel_conversation_id=f.conversation_id
  left join offer_drafts d on d.id=l.draft_id
  join offers o on o.id=f.offer_id or o.serial=d.data->>'produced_serial'
  where o.status='confirmed' and exists(select 1 from offer_status_history h where h.offer_id=o.id and h.to_status='confirmed' and h.created_at>=f.created_at)
  order by o.id,f.created_at desc
$$;
revoke all on function public.followup_confirmed_bookings() from public,anon,authenticated;
grant execute on function public.followup_confirmed_bookings() to service_role;
commit;
