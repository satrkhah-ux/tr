-- A partner company's team (partner order 8): more than one login per company,
-- each with a role.
--
--  · owner — the company's manager: its account with us (statement, invoices),
--    its team (invite, suspend), its identity.
--  · sales — issues offers and confirms its clients; does not see the account.
--
-- Every login issued before this migration is the company's first, so it is its
-- owner. RLS is unchanged: both roles read the company's rows; the role decides
-- what the portal shows and which actions it accepts.

alter table public.partner_users
  add column if not exists role text not null default 'owner'
    check (role in ('owner', 'sales'));

notify pgrst, 'reload schema';
