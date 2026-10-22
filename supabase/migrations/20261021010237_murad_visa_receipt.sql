alter table public.client_leads add column if not exists murad_receipt jsonb;
comment on column public.client_leads.murad_receipt is 'Actual Murad first receipt and confirmed visa handoff; independent from provider staff timeline';
update public.integrations set used_by=concat_ws(E'\n',used_by,'مُراد: تحويل التأشيرات إلى موظف متاح من أعضاء القسم أو إبقاؤها في قائمة القسم؛ مع التحقق من الإسناد'),updated_at=now() where name='Teletel (Chatwoot)' and coalesce(used_by,'') not like '%تحويل التأشيرات إلى موظف متاح%';
