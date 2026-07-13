-- App Travluin — offer pipeline: kanban stage + lock internal pricing + sample offers.

-- 1) Kanban stage (free-form pipeline column, separate from the status enum).
alter table public.offers add column if not exists pipeline_stage text not null default 'active_not_confirmed';

-- 2) SECURITY: pricings holds buy_total / profit — must never be readable by anon
--    (client offer links use the anon key). Revoke the public read policy.
drop policy if exists public_read on public.pricings;

-- 3) Sample offers so the kanban / hub / generator show real data.
--    Buy price & profit live in pricings (server-only), never in client output.
do $$
declare
  admin_id uuid := (select id from public.employees where english_name = 'Admin' limit 1);
  rec record;
  new_id uuid;
begin
  for rec in
    select * from (values
      ('AD-2-1057-20260626', 'تايلند',     '2026-06-26', 18087.54, 2359.24, 'sent',      'followed_up'),
      ('AD-3-7734-20260707', 'تركيا',      '2026-07-07', 11204.75,  634.23, 'draft',     'active_not_confirmed'),
      ('AD-1-6746-20251106', 'إندونيسيا',  '2025-11-06',  1380.00,  180.00, 'cancelled', 'active_not_confirmed'),
      ('AD-1-5211-20260701', 'ماليزيا',    '2026-07-01',  8419.46, 1000.00, 'confirmed', 'confirmed_hotels'),
      ('MY-2-8821-20260511', 'ماليزيا',    '2026-05-11',  8120.00,  760.00, 'sent',      'flights'),
      ('TR-5-1180-20260403', 'تركيا',      '2026-04-03',  5980.00,  540.00, 'draft',     'transportation'),
      ('TH-4-3400-20260218', 'تايلند',     '2026-02-18', 10450.00,  980.00, 'confirmed', 'completed')
    ) as t(serial, destination, offer_date, sell, profit, status, stage)
  loop
    if not exists (select 1 from public.offers where serial = rec.serial) then
      insert into public.offers (serial, employee_id, destination, offer_date, adults, total, currency, status, pipeline_stage)
      values (rec.serial, admin_id, rec.destination, rec.offer_date::date, 2, rec.sell, 'SAR', rec.status::public.offer_status, rec.stage)
      returning id into new_id;

      insert into public.pricings (offer_id, total, currency, buy_total, sell_total, profit)
      values (new_id, rec.sell, 'SAR', rec.sell - rec.profit, rec.sell, rec.profit);
    end if;
  end loop;

  -- set the pre-existing seeded offer onto a sensible stage
  update public.offers set pipeline_stage = 'confirmed_hotels'
  where serial = 'AD-1-1057-20260624' and pipeline_stage = 'active_not_confirmed';
end $$;
