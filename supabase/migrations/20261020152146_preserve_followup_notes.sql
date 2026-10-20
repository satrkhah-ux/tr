-- Preserve existing follow-up notes in the new timeline without changing case state.
insert into public.followup_attempts(followup_id,employee_id,kind,outcome,note,created_at)
select f.id,coalesce(f.done_by,f.assigned_to),'note',case when f.status='done' then 'completed' else null end,
 f.note,coalesce(f.done_at,f.replied_at,f.created_at)
from public.sla_followups f
where f.source='system' and f.note is not null
 and not exists(select 1 from public.followup_attempts a where a.followup_id=f.id);
