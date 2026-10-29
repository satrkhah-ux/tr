-- «الغلاف الفني»: the first page of the client's PDF, chosen by the employee per offer (staff-only wording; never printed).
-- basic = the plain first page (default), designed = the designed cover. The client link, its PDF, the WhatsApp send and a
-- re-issue (same serial) all read this one column.
alter table public.offers add column if not exists pdf_cover text not null default 'basic';
do $$ begin
  alter table public.offers add constraint offers_pdf_cover_check check (pdf_cover in ('basic', 'designed'));
exception when duplicate_object then null; end $$;
