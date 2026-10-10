-- App Travluin — mark the agency's own vehicles as the FLEET.
--
-- `transportation_types` holds two different things under one roof. Most of it
-- is a product catalogue for pricing: an airport pickup, four hours of
-- disposal, a metro pass, a cable-car ticket. A handful of rows are the actual
-- vehicles the agency puts a group into, and those are the only answers to the
-- generator's question «نوع السيارة».
--
-- Guessing the difference from `category` + `vehicle_class` did not hold: it
-- offered a motorbike to a family of nine, a self-drive rental for an airport
-- transfer, and «سيارة خاصة مع سائق - سيدان» beside «سيارة صغيرة» — the same
-- car described twice, once as a service and once as a vehicle.
--
-- So it is stated, not inferred. `category = 'fleet'` means "an agent may
-- assign this to a leg". Everything else stays exactly where it is and keeps
-- showing on /cars-types for pricing and reference.
--
-- Idempotent; safe to re-run.

-- The vehicles imported from the old system's `cars_types` ARE the fleet —
-- that list is what the agency quotes from.
update public.transportation_types tt
set category = 'fleet'
where exists (
  select 1 from public.legacy_id_map m
  where m.entity = 'car_type' and m.source = 'app' and m.new_id = tt.id
);

-- Two of the seeded rows are vehicles rather than products, and an agent does
-- genuinely assign them to a leg. Named explicitly rather than matched by a
-- pattern, because that is the whole point of this migration.
update public.transportation_types
set category = 'fleet'
where category <> 'fleet'
  and english_name in ('Limousine / VIP', 'Wheelchair-accessible vehicle');

notify pgrst, 'reload schema';
