-- ============================================================================
-- 0086 — a flight booking says its route once (NOT applied — data only)
--
-- The pull (seed-plan.ts) titled a flight «طيران داخلي IST → TZX · TZX → IST»
-- and put the same route in city_name, so every «title — city» line read
-- «… IST → TZX · TZX → IST — IST → TZX · TZX → IST». The pull now leaves a
-- flight's city empty; this clears it on the flights already pulled — only
-- where the title already holds it, so a flight titled by its airline and
-- number («الخطوط الماليزية MH1430») keeps its route in the city.
-- Idempotent. No schema change.
-- ============================================================================

update public.operation_bookings
   set city_name = ''
 where kind = 'flight'
   and coalesce(city_name, '') <> ''
   and position(city_name in title) > 0;

-- ROLLBACK: none needed — the route is still in each title.
