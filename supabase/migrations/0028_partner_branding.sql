-- ============================================================================
-- 0028 — «الشركات المتعاونة»: brand identity on the partner company
--
-- Some offers are not sold by us. A partner agency takes the file and resells it
-- to their own client, so the document has to carry THEIR name, logo and colours
-- — and often no price at all, because their margin is not ours to print.
--
-- This EXTENDS booking_partners rather than adding a second table. The same
-- company both executes bookings for us (0027) and resells our files; two tables
-- would mean entering the same agency twice and two screens both labelled
-- «الشركات المتعاونة».
-- ============================================================================

-- Latin name for the logo alt text and the PDF metadata footer.
alter table public.booking_partners add column if not exists name_latin text;

-- Path inside the PUBLIC `brands` bucket. A path, not a URL: the on-screen
-- preview builds a public URL from it and the print pipeline inlines the bytes
-- as a data URI (Chromium prints with no network).
alter table public.booking_partners add column if not exists logo_path text;

-- The two colours the document is built from. Every other shade in the
-- stylesheet is derived from these by tinting toward white, so a partner
-- supplies two hexes and gets a coherent document.
alter table public.booking_partners
  add column if not exists brand_color text not null default '#135549';
alter table public.booking_partners
  add column if not exists accent_color text not null default '#f0ad22';

-- Printed on the cover block in place of ours.
alter table public.booking_partners add column if not exists address text;
alter table public.booking_partners add column if not exists whatsapp text;
alter table public.booking_partners add column if not exists website text;

-- Their DEFAULT when a file is issued for them. The person exporting can still
-- flip it per file; this only decides what the toggle starts on.
alter table public.booking_partners
  add column if not exists show_prices boolean not null default false;

-- Does this company resell our files, or only execute bookings? Both lists come
-- from one table, and a hotel supplier has no business appearing in the branding
-- picker.
alter table public.booking_partners
  add column if not exists resells boolean not null default false;

-- Hex, exactly six digits, so a bad paste cannot reach the stylesheet.
alter table public.booking_partners drop constraint if exists booking_partners_brand_color_hex;
alter table public.booking_partners
  add constraint booking_partners_brand_color_hex check (brand_color ~ '^#[0-9a-fA-F]{6}$');
alter table public.booking_partners drop constraint if exists booking_partners_accent_color_hex;
alter table public.booking_partners
  add constraint booking_partners_accent_color_hex check (accent_color ~ '^#[0-9a-fA-F]{6}$');

-- Which partner a given offer is branded for. NULL = our own identity, which is
-- what every existing offer keeps.
alter table public.offers
  add column if not exists partner_company_id uuid references public.booking_partners (id) on delete set null;

create index if not exists offers_partner_company_idx on public.offers (partner_company_id)
  where partner_company_id is not null;

-- ---------- public storage bucket for partner logos ----------
-- PUBLIC on purpose, unlike the passports bucket: a logo is a company's own
-- public mark, it must render inside a document a client opens with no session,
-- and the alternative — signed URLs — would expire inside a saved PDF.
insert into storage.buckets (id, name, public)
values ('brands', 'brands', true)
on conflict (id) do nothing;

-- Writes stay with signed-in staff; reads are public by virtue of the bucket.
drop policy if exists brands_write on storage.objects;
create policy brands_write on storage.objects for all to authenticated
  using (bucket_id = 'brands') with check (bucket_id = 'brands');
