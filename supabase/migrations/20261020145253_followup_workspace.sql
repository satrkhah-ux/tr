begin;
alter table public.sla_followups
  add column if not exists stage text not null default 'new',
  add column if not exists request_started_at timestamptz,
  add column if not exists next_followup_at timestamptz,
  add column if not exists first_followed_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_client_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists source text not null default 'system',
  add column if not exists source_team_id integer,
  add column if not exists transfer_reason text,
  add column if not exists outcome text,
  add column if not exists external_status text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists send_lock uuid;
update public.sla_followups set request_started_at=created_at where request_started_at is null;
update public.sla_followups set stage='completed' where status='done';
alter table public.sla_followups alter column request_started_at set default now();
create index if not exists followups_request_order on public.sla_followups(request_started_at desc,id);
create index if not exists followups_due on public.sla_followups(next_followup_at) where status='open';
alter table public.sla_followups add constraint followup_stage_valid check(stage in ('new','working','waiting','scheduled','transferred','completed'));

create table public.followup_attempts(
  id uuid primary key default gen_random_uuid(),
  followup_id uuid not null references public.sla_followups(id),
  employee_id uuid references public.employees(id),
  kind text not null,
  outcome text,
  note text,
  due_at timestamptz,
  provider_message_id bigint,
  target_team_id integer,
  delivery_state text not null default 'recorded' check(delivery_state in ('recorded','pending','sent','uncertain','failed')),
  created_at timestamptz not null default now()
);
create index followup_attempts_history on public.followup_attempts(followup_id,created_at desc);
create table public.followup_agent_map(
  agent_id integer primary key,
  employee_id uuid not null unique references public.employees(id)
);
alter table public.followup_attempts enable row level security;
alter table public.followup_agent_map enable row level security;
revoke all on public.sla_followups,public.followup_attempts,public.followup_agent_map from anon,authenticated;
grant select,insert,update on public.sla_followups,public.followup_attempts,public.followup_agent_map to service_role;
grant delete on public.followup_agent_map to service_role;

-- Service-only helpers. Browser callers cannot select a different actor.
create function public.followup_employee_can(p_employee uuid,p_key text) returns boolean
language sql stable security invoker set search_path=public as $$
  select exists(select 1 from employees e left join roles r on r.id=e.role_id
    where e.id=p_employee and e.status='Active'
    and p_key=any(coalesce(r.permission_keys,'{}')||coalesce(e.extra_permission_keys,'{}'))
    and not(p_key=any(coalesce(e.removed_permission_keys,'{}'))))
$$;
revoke all on function public.followup_employee_can(uuid,text) from public,anon,authenticated;
grant execute on function public.followup_employee_can(uuid,text) to service_role;

create function public.followup_action(p_id uuid,p_actor uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare
  f sla_followups%rowtype; a followup_attempts%rowtype; manager boolean;
  target uuid; due timestamptz; outcome_value text; next_stage text; request_id uuid;
begin
  manager:=followup_employee_can(p_actor,'followups.manage') or followup_employee_can(p_actor,'dashboard.admin') or followup_employee_can(p_actor,'developer.access');
  if not manager and not followup_employee_can(p_actor,'followups.work') then return '{"ok":false,"error":"forbidden"}'; end if;
  select * into f from sla_followups where id=p_id for update;
  if not found then return '{"ok":false,"error":"notFound"}'; end if;
  if p_action='claim' then
    if f.status<>'open' or f.assigned_to is not null or f.send_lock is not null then return '{"ok":false,"error":"claimed"}'; end if;
    update sla_followups set assigned_to=p_actor,assigned_by=p_actor,assigned_at=now(),stage='working' where id=p_id;
    insert into followup_attempts(followup_id,employee_id,kind,note) values(p_id,p_actor,'claim','استلام المتابعة');
    return '{"ok":true}';
  end if;
  if not manager and f.assigned_to is distinct from p_actor then return '{"ok":false,"error":"forbidden"}'; end if;
  if p_action in ('finish_send','finish_transfer') then
    request_id:=(p_data->>'requestId')::uuid;
    if f.send_lock is distinct from request_id then return '{"ok":false,"error":"conflict"}'; end if;
    if p_data->>'state' not in ('sent','uncertain','failed') then return '{"ok":false,"error":"invalid"}'; end if;
    update followup_attempts set delivery_state=p_data->>'state',provider_message_id=(p_data->>'messageId')::bigint where id=request_id and followup_id=p_id;
    update sla_followups set send_lock=case when p_data->>'state'='uncertain' then request_id else null end,
      replied_at=case when p_data->>'state'='sent' then now() else replied_at end,
      first_followed_at=case when p_data->>'state'='sent' then coalesce(first_followed_at,now()) else first_followed_at end,
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
    if target is not null and not (followup_employee_can(target,'followups.work') or followup_employee_can(target,'followups.manage') or followup_employee_can(target,'dashboard.admin') or followup_employee_can(target,'developer.access')) then return '{"ok":false,"error":"invalid"}'; end if;
    update sla_followups set assigned_to=target,assigned_by=p_actor,assigned_at=case when target is null then null else now() end,
      stage=case when target is null then 'new' else 'working' end where id=p_id;
    insert into followup_attempts(followup_id,employee_id,kind,note) values(p_id,p_actor,'assign',coalesce(target::text,'إلغاء الإسناد'));
  elsif p_action in ('reserve_send','reserve_transfer') then
    if length(trim(coalesce(p_data->>'text','')))=0 or length(p_data->>'text')>4000 then return '{"ok":false,"error":"invalid"}'; end if;
    insert into followup_attempts(id,followup_id,employee_id,kind,note,delivery_state,target_team_id)
      values(request_id,p_id,p_actor,case when p_action='reserve_transfer' then 'transfer' else 'message' end,p_data->>'text','pending',(p_data->>'targetTeamId')::integer);
    update sla_followups set send_lock=request_id,last_attempt_at=now(),attempt_count=attempt_count+1 where id=p_id;
  elsif p_action='result' then
    outcome_value:=p_data->>'outcome';
    if outcome_value not in ('no_answer','interested','revise_offer','later','not_interested','completed','transferred') then return '{"ok":false,"error":"invalid"}'; end if;
    due:=case when outcome_value in ('completed','not_interested','transferred') then null else (p_data->>'dueAt')::timestamptz end;
    if due is not null and due<=now() then return '{"ok":false,"error":"due"}'; end if;
    if outcome_value in ('later','no_answer') and (due is null or due<=now()) then return '{"ok":false,"error":"due"}'; end if;
    if outcome_value in ('transferred','completed','not_interested') and length(trim(coalesce(p_data->>'note','')))<1 then return '{"ok":false,"error":"invalid"}'; end if;
    next_stage:=case when outcome_value='transferred' then 'transferred' when outcome_value in ('not_interested','completed') then 'completed' when due is not null then 'scheduled' else 'working' end;
    insert into followup_attempts(followup_id,employee_id,kind,outcome,note,due_at)
      values(p_id,p_actor,coalesce(p_data->>'channel','note'),outcome_value,left(p_data->>'note',2000),due);
    update sla_followups set outcome=outcome_value,stage=next_stage,next_followup_at=due,last_attempt_at=now(),
      first_followed_at=coalesce(first_followed_at,now()),attempt_count=attempt_count+1,
      status=case when next_stage in ('completed','transferred') then 'done' else 'open' end,
      done_at=case when next_stage in ('completed','transferred') then now() else null end,
      done_by=case when next_stage in ('completed','transferred') then p_actor else null end,
      note=left(p_data->>'note',2000) where id=p_id;
  else return '{"ok":false,"error":"invalid"}';
  end if;
  return '{"ok":true}';
end $$;
revoke all on function public.followup_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.followup_action(uuid,uuid,text,jsonb) to service_role;

create function public.followup_confirmed_bookings() returns table(followup_id uuid,serial text)
language sql stable security invoker set search_path=public as $$
  select distinct on(o.id) f.id,o.serial::text from sla_followups f
  join client_leads l on l.teletel_conversation_id=f.conversation_id
  join offer_drafts d on d.id=l.draft_id
  join offers o on o.serial=d.data->>'produced_serial'
  where o.status='confirmed' and exists(select 1 from offer_status_history h where h.offer_id=o.id and h.to_status='confirmed' and h.created_at>=f.created_at)
  order by o.id,f.created_at desc
$$;
revoke all on function public.followup_confirmed_bookings() from public,anon,authenticated;
grant execute on function public.followup_confirmed_bookings() to service_role;

insert into public.roles(arabic_name,english_name,permission_keys)
select 'موظف المتابعة','Followup agent',array['dashboard.employee','followups.work']
where not exists(select 1 from public.roles where english_name='Followup agent');
insert into public.roles(arabic_name,english_name,permission_keys)
select 'مشرف المتابعة','Followup supervisor',array['dashboard.employee','followups.work','followups.manage']
where not exists(select 1 from public.roles where english_name='Followup supervisor');
update public.roles set permission_keys=(select array_agg(distinct k) from unnest(permission_keys||array['followups.work','followups.manage']) k)
where 'dashboard.admin'=any(permission_keys) or 'developer.access'=any(permission_keys);
insert into public.app_settings(key,value) values('followup_team_id','28') on conflict(key) do nothing;
update public.integrations set used_by=concat_ws('؛ ',used_by,'قسم المتابعة: مزامنة فريق متابعة المبيعات، إرسال الموظف، وربط معرّفات الموظفين'),
 updated_at=now() where check_key='teletel' and coalesce(used_by,'') not like '%قسم المتابعة:%';
update public.integrations set used_by=concat_ws('؛ ',used_by,'مزامنة المتابعة كل دقيقة عبر /api/murad/run'),
 updated_at=now() where check_key='job_murad' and coalesce(used_by,'') not like '%مزامنة المتابعة%';
insert into public.integrations(name,kind,used_by,secret_ref,account,check_key)
select 'مزامنة قسم المتابعة','cron','فريق متابعة المبيعات والمواعيد؛ ضمن المهمة الحالية /api/murad/run كل دقيقة','ADMIN_API_SECRET','vps-new / traveliun-app','followups_sync'
where not exists(select 1 from public.integrations where check_key='followups_sync');
-- Receipt history is committed in the same transaction as enrollment.
create function public.followup_received() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 insert into followup_attempts(followup_id,employee_id,kind,note) values(new.id,new.assigned_by,'received',new.transfer_reason);
 return new;
end $$;
revoke all on function public.followup_received() from public,anon,authenticated;
create trigger followup_received after insert on public.sla_followups for each row execute function public.followup_received();
create function public.followup_wake(p_conversation bigint,p_at timestamptz) returns void language plpgsql security invoker set search_path=public as $$
declare f sla_followups%rowtype;
begin
 select * into f from sla_followups where conversation_id=p_conversation and status='open' for update;
 if not found or p_at<=coalesce(f.last_client_at,f.created_at) then return; end if;
 update sla_followups set last_client_at=p_at,
 stage=case when stage in ('waiting','scheduled') then case when assigned_to is null then 'new' else 'working' end else stage end,
 next_followup_at=case when stage in ('waiting','scheduled') then null else next_followup_at end where id=f.id;
 insert into followup_attempts(followup_id,kind,note) values(f.id,'incoming','رد جديد من العميل');
end $$;
revoke all on function public.followup_wake(bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.followup_wake(bigint,timestamptz) to service_role;
commit;
