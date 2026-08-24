-- App Travluin — the cost and the margin stop being readable by every employee.
--
-- 0034 closed the tables to non-staff, which was the urgent hole. What it could
-- not express is the one INSIDE the company: `pricings` and
-- `offer_pricing_items` were `ALL to is_staff()`, so a visa clerk or a
-- salesperson could read buy_total, profit and buy_price straight from
-- PostgREST with the anon key and their own token. The UI gates that behind
-- pricing.internal; the database did not, and the database is the one that
-- cannot be bypassed by typing a different URL.
--
-- RLS is the wrong instrument here: the rows are legitimately needed by people
-- who must not see the money. Operations seeds its bookings from
-- offer_pricing_items (id, item_type, description, quantity) and holds no
-- pricing permission at all — a row-level lock would break that.
--
-- So this is COLUMN privilege. A column-list GRANT cannot narrow an existing
-- table-wide GRANT, so each table is revoked and re-granted by name.
--
-- The internal document, the executive dashboard and the pricing engine read
-- the withheld columns; they now do it through the service client behind an
-- explicit pricing.internal check in code, which is where that decision was
-- always supposed to live.

-- ---------- pricings: buy_total and profit withheld ----------
revoke select on public.pricings from authenticated;
grant select (id, offer_id, total, currency, sell_total, created_at)
  on public.pricings to authenticated;

-- ---------- offer_pricing_items: the buy side withheld ----------
revoke select on public.offer_pricing_items from authenticated;
grant select (id, offer_id, item_type, item_id, description, quantity,
              sell_price, sell_currency, total_sell, sort, created_at)
  on public.offer_pricing_items to authenticated;

-- ---------- markup_rules: our margin policy, staff-invisible entirely ----------
-- Nothing an employee sees needs to know HOW we mark up; the engine applies it
-- server-side. Writes stay available so the admin screen keeps working through
-- its own permission-checked action.
revoke select on public.markup_rules from authenticated;

notify pgrst, 'reload schema';
