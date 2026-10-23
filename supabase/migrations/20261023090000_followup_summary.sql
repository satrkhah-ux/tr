begin;
-- «ملخص مُراد» on every follow-up (the owner, 2026-10-23) and the thread's last line with who wrote it.
alter table public.sla_followups
  add column if not exists summary jsonb,
  add column if not exists last_line text,
  add column if not exists last_by text check (last_by in ('client','us')),
  add column if not exists murad_note_at timestamptz;

create or replace function public.followup_action(p_id uuid,p_actor uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  f sla_followups%rowtype; a followup_attempts%rowtype; manager boolean; team boolean; closer boolean;
  target uuid; due timestamptz; outcome_value text; next_stage text; request_id uuid; reason text; next_step smallint; sent boolean;
begin
  manager:=followup_employee_can(p_actor,'followups.manage') or followup_employee_can(p_actor,'dashboard.admin') or followup_employee_can(p_actor,'developer.access');
  team:=manager or followup_employee_can(p_actor,'followups.work');
  select * into f from sla_followups where id=p_id for update;
  if not found then return '{"ok":false,"error":"notFound"}'; end if;
  -- day seven and the close may be a named follow-up employee's («من يتولى اليوم السابع والإغلاق»)
  closer:=coalesce(f.step,0)>=3 and exists(select 1 from app_settings s where s.key='followup_settings'
    and s.value::jsonb->>'closer'='employee' and s.value::jsonb->>'closerId'=p_actor::text);
  -- a seller works his own files without being on the follow-up team (the owner, 2026-10-23)
  if not team and not closer and f.assigned_to is distinct from p_actor then return '{"ok":false,"error":"forbidden"}'; end if;
  if p_action='claim' then
    if f.status<>'open' or f.assigned_to is not null or f.send_lock is not null then return '{"ok":false,"error":"claimed"}'; end if;
    update sla_followups set assigned_to=p_actor,assigned_by=p_actor,assigned_at=now(),stage=case when stage='new' then 'working' else stage end where id=p_id;
    insert into followup_attempts(followup_id,employee_id,kind,note) values(p_id,p_actor,'claim','استلام المتابعة');
    return '{"ok":true}';
  end if;
  if not manager and not closer and f.assigned_to is distinct from p_actor then return '{"ok":false,"error":"forbidden"}'; end if;
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
  elsif p_action='restart' then
    -- «أعد للمتابعة» / «أدخلها في الخطوات» (managers, «مراجعة قبل الأرشفة»): the file joins the steps from the step named
    if not manager then return '{"ok":false,"error":"forbidden"}'; end if;
    next_step:=(p_data->>'step')::smallint;
    due:=(p_data->>'dueAt')::timestamptz;
    if next_step is null or next_step not between 0 and 3 or due is null or (p_data->>'offerAt') is null then return '{"ok":false,"error":"invalid"}'; end if;
    update sla_followups set source=case when source='sla' then 'price' else source end,offer_at=coalesce(offer_at,(p_data->>'offerAt')::timestamptz),
      step=next_step,next_followup_at=due,stage=case when assigned_to is null then 'new' else 'waiting' end where id=p_id;
    insert into followup_attempts(followup_id,employee_id,kind,note,due_at) values(p_id,p_actor,'note','أُعيد إلى خطوات المتابعة',due);
  else return '{"ok":false,"error":"invalid"}';
  end if;
  return '{"ok":true}';
end $$;
revoke all on function public.followup_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.followup_action(uuid,uuid,text,jsonb) to service_role;
commit;
