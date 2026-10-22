begin;
create or replace function public.protect_manual_lead_inquiry()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.inquiry_source = 'manual'
    and old.inquiry in ('بكج','فنادق','طيران','تأشيرات','مواصلات','رخص دولية')
    and new.inquiry_source in ('auto','murad') then
    new.inquiry := old.inquiry;
    new.inquiry_source := old.inquiry_source;
  end if;
  if new.inquiry is not null and new.inquiry not in ('بكج','فنادق','طيران','تأشيرات','مواصلات','رخص دولية','طلب غير واضح') then
    new.inquiry := 'طلب غير واضح';
  end if;
  return new;
end;
$$;
create or replace function public.clear_corrected_unclear_referral() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.inquiry = 'طلب غير واضح'
    and new.inquiry in ('بكج','طيران','فنادق','تأشيرات','مواصلات','رخص دولية') then
    update public.sla_followups f set status = 'done', stage = 'transferred',
      done_at = now(), outcome = null,
      note = 'تصحيح التصنيف: الطلب واضح ولا يحتاج متابعة لتحديد الخدمة' 
    where f.conversation_id = new.teletel_conversation_id
      and f.source = 'sla'
      and f.transfer_reason = 'طلب غير واضح — متابعة العميل لتحديد الخدمة المطلوبة'
      and f.status = 'open' and f.stage = 'new'
      and f.assigned_to is null and f.assigned_at is null
      and f.send_lock is null and f.first_followed_at is null
      and f.last_attempt_at is null and f.attempt_count = 0
      and not exists (select 1 from public.followup_attempts a where a.followup_id = f.id and (a.employee_id is not null or a.kind not in ('received','incoming')));
  end if;
  return new;
end;
$$;
revoke all on function public.clear_corrected_unclear_referral() from public,anon,authenticated;
commit;
