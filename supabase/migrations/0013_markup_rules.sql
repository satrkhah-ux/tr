-- App Travluin — markup rules catalog (admin-editable pricing rules).
-- The pricing engine (src/lib/pricing/markup.ts) selects the most specific
-- matching rule (with a default fallback) to turn a supplier NET into a client
-- SELL. Idempotent; safe to re-run.

create table if not exists public.markup_rules (
  id uuid primary key default gen_random_uuid(),
  arabic_name text not null,
  english_name text,
  -- scope the markup applies at
  scope text not null default 'per_hotel_line' check (scope in ('per_room_night', 'per_hotel_line', 'package')),
  markup_type text not null default 'percentage' check (markup_type in ('percentage', 'fixed')),
  markup_value numeric(12, 2) not null default 0,
  -- match criteria (null = wildcard)
  country text,
  city text,
  supplier_id text,
  star_rating int,
  season_start text, -- "MM-DD"
  season_end text,   -- "MM-DD"
  customer_type text check (customer_type is null or customer_type in ('individual', 'corporate', 'vip')),
  is_default boolean not null default false,
  -- constraints
  min_margin_pct numeric(8, 2),
  rounding_mode text check (rounding_mode is null or rounding_mode in ('up', 'nearest', 'down')),
  rounding_step numeric(10, 2),
  priority int not null default 0,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

-- Seed a single all-wildcard default rule so pricing always has a fallback:
-- +20% per hotel line, minimum 8% margin, round the sell up to the nearest 5.
insert into public.markup_rules
  (arabic_name, english_name, scope, markup_type, markup_value, is_default, min_margin_pct, rounding_mode, rounding_step, priority, status)
select 'قاعدة الهامش الافتراضية', 'Default markup', 'per_hotel_line', 'percentage', 20, true, 8, 'up', 5, 0, 'Active'
where not exists (select 1 from public.markup_rules where is_default = true);

do $$ begin
  execute 'alter table public.markup_rules enable row level security';
  execute 'drop policy if exists authenticated_all on public.markup_rules';
  execute 'create policy authenticated_all on public.markup_rules for all to authenticated using (true) with check (true)';
end $$;
