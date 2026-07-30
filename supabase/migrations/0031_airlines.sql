-- ============================================================================
-- 0031 — «شركات الطيران»: the carriers, their designators, and their marks
--
-- The nav has had an Airlines entry since the first release and the table behind
-- it never existed, so the page rendered "not ready". Flights carried the airline
-- as free text typed per offer — which is why the same carrier appears as
-- «السعودية», «الخطوط السعودية» and «Saudia» across the drafts, and why no
-- document could ever show a logo.
--
-- The IATA designator is the join: an agent types SV820, the parser already
-- extracts SV (flight-lookup.ts), and that is enough to name the carrier and draw
-- its mark without a lookup, a key, or a network call.
-- ============================================================================

create table if not exists public.airlines (
  id uuid primary key default gen_random_uuid(),
  -- two characters, the designator printed on a ticket. UNIQUE: it is the key
  -- everything else joins on.
  iata text not null,
  icao text,
  arabic_name text not null,
  english_name text,
  -- path inside the PUBLIC `airlines` bucket; the document inlines the bytes.
  logo_path text,
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  constraint airlines_iata_format check (iata ~ '^[A-Z0-9]{2}$'),
  constraint airlines_icao_format check (icao is null or icao ~ '^[A-Z]{3}$')
);

create unique index if not exists airlines_iata_key on public.airlines (iata);

alter table public.airlines enable row level security;
drop policy if exists airlines_authenticated_all on public.airlines;
create policy airlines_authenticated_all
  on public.airlines for all to authenticated using (true) with check (true);
-- The client offer page is public and now draws these marks, so anon may READ.
-- Nothing sensitive: a designator, a name and a logo path.
drop policy if exists airlines_public_read on public.airlines;
create policy airlines_public_read on public.airlines for select to anon using (true);

-- ---------- which carrier a flight is on ----------
-- Stored per flight so a published offer keeps drawing the right mark even if the
-- airline row is renamed later.
alter table public.offer_flights add column if not exists airline_iata text;

-- ---------- the carriers this office actually sells ----------
insert into public.airlines (iata, icao, arabic_name, english_name) values
  ('SV','SVA','الخطوط السعودية','Saudia'),
  ('XY','KNE','طيران ناس','flynas'),
  ('F3','FAD','طيران أديل','flyadeal'),
  ('MS','MSR','مصر للطيران','EgyptAir'),
  ('TK','THY','الخطوط التركية','Turkish Airlines'),
  ('PC','PGT','بيجاسوس','Pegasus Airlines'),
  ('QR','QTR','الخطوط القطرية','Qatar Airways'),
  ('EK','UAE','طيران الإمارات','Emirates'),
  ('FZ','FDB','فلاي دبي','flydubai'),
  ('EY','ETD','الاتحاد للطيران','Etihad Airways'),
  ('G9','ABY','العربية للطيران','Air Arabia'),
  ('GF','GFA','طيران الخليج','Gulf Air'),
  ('WY','OMA','الطيران العُماني','Oman Air'),
  ('KU','KAC','الخطوط الكويتية','Kuwait Airways'),
  ('J9','JZR','طيران الجزيرة','Jazeera Airways'),
  ('RJ','RJA','الملكية الأردنية','Royal Jordanian'),
  ('ME','MEA','طيران الشرق الأوسط','Middle East Airlines'),
  ('IA','IAW','الخطوط العراقية','Iraqi Airways'),
  ('J2','AHY','الخطوط الأذربيجانية','Azerbaijan Airlines'),
  ('A9','TGZ','الطيران الجورجي','Georgian Airways'),
  ('MH','MAS','الخطوط الماليزية','Malaysia Airlines'),
  ('AK','AXM','إير آسيا','AirAsia'),
  ('OD','MXD','باتيك آير ماليزيا','Batik Air Malaysia'),
  ('TG','THA','الخطوط التايلاندية','Thai Airways'),
  ('SQ','SIA','طيران سنغافورة','Singapore Airlines'),
  ('ET','ETH','الخطوط الإثيوبية','Ethiopian Airlines'),
  ('LH','DLH','لوفتهانزا','Lufthansa'),
  ('AF','AFR','الخطوط الفرنسية','Air France'),
  ('BA','BAW','الخطوط البريطانية','British Airways'),
  ('TP','TAP','تاب البرتغالية','TAP Air Portugal'),
  ('AZ','ITY','آيتا الإيطالية','ITA Airways'),
  ('PK','PIA','الخطوط الباكستانية','Pakistan International'),
  ('6E','IGO','إنديغو','IndiGo'),
  ('AI','AIC','الخطوط الهندية','Air India'),
  ('UL','ALK','السريلانكية','SriLankan Airlines'),
  ('GA','GIA','غارودا الإندونيسية','Garuda Indonesia'),
  ('ID','BTK','باتيك آير','Batik Air'),
  ('VN','HVN','الخطوط الفيتنامية','Vietnam Airlines'),
  ('CX','CPA','كاثي باسيفيك','Cathay Pacific'),
  ('W6','WZZ','ويز إير','Wizz Air'),
  ('U2','EZY','إيزي جيت','easyJet'),
  ('MU','CES','الصينية الشرقية','China Eastern'),
  ('HY','UZB','أوزبكستان للطيران','Uzbekistan Airways'),
  ('KC','KZR','إير أستانا','Air Astana')
on conflict (iata) do nothing;

-- ---------- public bucket for the marks ----------
-- PUBLIC like `brands` (0028) and for the same reason: the mark is drawn inside a
-- document a client opens with no session, and a signed URL would expire inside a
-- saved PDF.
insert into storage.buckets (id, name, public)
values ('airlines', 'airlines', true)
on conflict (id) do nothing;

drop policy if exists airlines_logo_write on storage.objects;
create policy airlines_logo_write on storage.objects for all to authenticated
  using (bucket_id = 'airlines') with check (bucket_id = 'airlines');

-- ---------- backfill: the designator was always in the flight number ----------
-- Existing legs carry «SV832» / «EK806», so their carrier is already known and
-- their documents can draw the mark without anyone re-entering anything. Scoped to
-- rows that have none, so re-running changes nothing.
update public.offer_flights f set airline_iata = a.iata
  from public.airlines a
 where f.airline_iata is null
   and f.flight_no is not null
   and upper(regexp_replace(f.flight_no, '[^A-Za-z0-9]', '', 'g')) ~ ('^' || a.iata || '[0-9]{1,4}$');

-- ---------- the relationship, not just the column ----------
-- PostgREST embeds `airlines:airline_iata(logo_path)` only when a FOREIGN KEY
-- says the two are related; without it the whole flights select fails and the
-- document silently loses its flight page. Learned the hard way.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'offer_flights_airline_iata_fkey') then
    alter table public.offer_flights
      add constraint offer_flights_airline_iata_fkey
      foreign key (airline_iata) references public.airlines (iata)
      on update cascade on delete set null;
  end if;
end $$;

-- PostgREST caches the schema; a new table or relationship is invisible until it
-- reloads. Signalling it here means a fresh deploy works without a restart.
notify pgrst, 'reload schema';
