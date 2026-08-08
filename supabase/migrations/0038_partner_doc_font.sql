-- App Travluin — a company's typeface is part of its identity.
--
-- booking_partners already carries the name, the logo and two colours. The one
-- thing still ours on a partner's sheet was the lettering, which is the most
-- visible identity choice a brand makes.
--
-- Constrained to the families we actually ship and embed. An arbitrary string
-- would produce a document that silently falls back to a default font at print
-- time — the kind of failure nobody notices until a client is holding it.

alter table public.booking_partners
  add column if not exists doc_font text not null default 'tajawal';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_partners_doc_font_check'
  ) then
    alter table public.booking_partners
      add constraint booking_partners_doc_font_check
      check (doc_font in ('tajawal', 'almarai', 'cairo', 'amiri'));
  end if;
end $$;

comment on column public.booking_partners.doc_font is
  'Arabic family embedded in this company''s printed documents. Must match a family shipped in public/fonts.';

notify pgrst, 'reload schema';
