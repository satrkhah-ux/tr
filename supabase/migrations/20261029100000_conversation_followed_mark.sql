-- «@#@#@#» (the owner, 2026-10-29): an employee's private note with that code in a Teletel conversation means
-- the employee followed it up, so Murad and the system send no reminder about what came before the note.
-- The latest mark is kept on the conversation's row in «العملاء» (src/lib/leads/lifecycle.ts markFollowed),
-- written by the webhook the moment the note is written and by the 5-minute pull as a fallback.

alter table public.client_leads add column if not exists followed_at timestamptz;
alter table public.client_leads add column if not exists followed_by text;

comment on column public.client_leads.followed_at is 'the latest «@#@#@#» private note in Teletel: the employee followed this conversation up — no reminder about anything before it';
comment on column public.client_leads.followed_by is 'who wrote that note (Teletel agent name)';
