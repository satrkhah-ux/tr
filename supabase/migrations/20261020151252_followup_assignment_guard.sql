begin;
-- A bulk assignment must not take a file that a worker claimed meanwhile.
create function public.followup_assign_available(p_id uuid,p_actor uuid,p_target uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare f sla_followups%rowtype;
begin
 if not(followup_employee_can(p_actor,'followups.manage') or followup_employee_can(p_actor,'dashboard.admin') or followup_employee_can(p_actor,'developer.access')) then return '{"ok":false,"error":"forbidden"}'; end if;
 select * into f from sla_followups where id=p_id for update;
 if not found or f.status<>'open' or f.assigned_to is not null then return '{"ok":false,"error":"claimed"}'; end if;
 return followup_action(p_id,p_actor,'assign',jsonb_build_object('employeeId',p_target));
end $$;
revoke all on function public.followup_assign_available(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.followup_assign_available(uuid,uuid,uuid) to service_role;
commit;
