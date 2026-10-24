-- «عميلنا محمد طلب بكج إلى جورجيا» (the user, 2026-10-25): a client who walks into
-- the office and asks for a programme. The agent ticks the box on the first step
-- of «النظام بيسك» and presses «التالي»; the screens show it like any request.
-- Unlike a conversation's row it has no lead: the file it came from (once per
-- file) and the client's short name as the agent typed it (three words at most,
-- trimmed by the server — never a phone). Idempotent.
alter table public.office_screen_events add column if not exists draft_id uuid references public.offer_drafts (id) on delete cascade;
alter table public.office_screen_events add column if not exists name text;
create unique index if not exists office_screen_events_draft on public.office_screen_events (draft_id) where draft_id is not null;
