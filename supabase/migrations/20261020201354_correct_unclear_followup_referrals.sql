begin;
-- Undo only untouched, system-created ambiguity referrals. Staff-owned work
-- and any recorded attempts remain intact. The lead's history is retained.
create or replace function public.clear_corrected_unclear_referral() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.inquiry = 'طلب غير واضح'
    and new.inquiry in ('بكج','طيران','فنادق','تأشيرات','مواصلات') then
    delete from public.sla_followups f
    where f.conversation_id = new.teletel_conversation_id
      and f.source = 'sla'
      and f.transfer_reason = 'طلب غير واضح — متابعة العميل لتحديد الخدمة المطلوبة'
      and f.status = 'open' and f.stage = 'new'
      and f.assigned_to is null and f.assigned_at is null
      and f.send_lock is null and f.first_followed_at is null
      and f.last_attempt_at is null and f.attempt_count = 0
      and not exists (select 1 from public.followup_attempts a where a.followup_id = f.id);
  end if;
  return new;
end;
$$;
revoke all on function public.clear_corrected_unclear_referral() from public,anon,authenticated;
drop trigger if exists clear_corrected_unclear_referral on public.client_leads;
create trigger clear_corrected_unclear_referral after update of inquiry on public.client_leads
for each row execute function public.clear_corrected_unclear_referral();
commit;
