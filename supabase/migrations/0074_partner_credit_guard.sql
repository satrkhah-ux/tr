-- A partner's credit limit, enforced where the invoice is written, and the
-- brands bucket limited to raster logos.
--
-- Additive and idempotent. Nothing here changes a row of data.
--
-- 1. raise_partner_invoice(p_offer_id, p_enforce_limit) — the ONE writer of
--    partner_invoices. It takes a per-partner advisory lock, recomputes what the
--    partner owes in the limit's currency (invoices minus payments, never
--    across currencies), and only then inserts the invoice, so the check and
--    the invoice that consumes the credit are one transaction: parallel
--    confirmations queue on the lock instead of each passing on the same
--    balance. With p_enforce_limit (the partner confirming from its portal):
--      · refused when the new invoice would take the balance past credit_limit;
--      · refused when a limit is set and the offer is in another currency —
--        the offer carries no frozen exchange rate to convert with, and an
--        unconverted file left uncounted would make the limit optional.
--    Without it (we confirm, from operations) the invoice is raised regardless.
--    Mirrors overCredit() in src/lib/partners/ledger-math.ts (tested there).
--    Returns the new invoice's id; null when there is nothing to raise (our own
--    offer, an offer with no partner_cost, or an invoice that already exists).
--    Raises (the app maps each to an i18n key — ledger-server.ts):
--      partner_cost_missing     enforcing, and the offer has no partner_cost
--      partner_credit_currency  enforcing, a limit is set, currencies differ
--      partner_credit_limit     enforcing, the invoice would pass the limit
--    VOLATILE on purpose (the default): each statement after the lock must see
--    what the transaction before it committed.
--    Service role only: the server action decides who may confirm, then calls it.
--
-- 2. storage bucket `brands` (public): png / jpeg / webp only, 2 MB. An SVG or
--    HTML object in a public bucket is a page on our storage domain that runs
--    script. Checked 2026-10-15: every object already in it is a PNG.

-- ---------- 1. the invoice, under the partner's lock ----------
create or replace function public.raise_partner_invoice(p_offer_id uuid, p_enforce_limit boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_limit numeric;
  v_limit_currency text;
  v_owed numeric;
  v_id uuid;
begin
  select id, serial, partner_company_id, partner_cost, coalesce(nullif(currency, ''), 'SAR') as currency
    into o
    from public.offers
   where id = p_offer_id;
  if not found then
    return null;
  end if;
  if o.partner_company_id is null then
    return null;
  end if;
  if o.partner_cost is null then
    if p_enforce_limit then
      raise exception 'partner_cost_missing';
    end if;
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext(o.partner_company_id::text));

  if exists (select 1 from public.partner_invoices where offer_id = o.id) then
    return null;
  end if;

  if p_enforce_limit then
    select credit_limit, credit_currency
      into v_limit, v_limit_currency
      from public.booking_partners
     where id = o.partner_company_id;
    if v_limit is not null then
      if o.currency <> v_limit_currency then
        raise exception 'partner_credit_currency';
      end if;
      select coalesce((select sum(amount) from public.partner_invoices
                        where partner_id = o.partner_company_id and currency = v_limit_currency), 0)
           - coalesce((select sum(amount) from public.partner_payments
                        where partner_id = o.partner_company_id and currency = v_limit_currency), 0)
        into v_owed;
      if v_owed + o.partner_cost > v_limit then
        raise exception 'partner_credit_limit';
      end if;
    end if;
  end if;

  -- numbered by its offer, as invoiceNoFor() in ledger-math.ts
  insert into public.partner_invoices (partner_id, offer_id, invoice_no, amount, currency)
  values (o.partner_company_id, o.id, 'INV-' || o.serial, o.partner_cost, o.currency)
  on conflict (offer_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.raise_partner_invoice(uuid, boolean) from public, anon, authenticated;
grant execute on function public.raise_partner_invoice(uuid, boolean) to service_role;

-- ---------- 2. brands: raster logos only ----------
update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'],
       file_size_limit = 2097152
 where id = 'brands';

notify pgrst, 'reload schema';

-- ---------- rollback ----------
-- Roll the APP back first (confirmPartnerOffer and recordConfirmation call the
-- function; without it a partner cannot confirm and our confirmations raise no
-- invoice). Then:
--
--   drop function if exists public.raise_partner_invoice(uuid, boolean);
--   update storage.buckets set allowed_mime_types = null, file_size_limit = null where id = 'brands';
--   notify pgrst, 'reload schema';
