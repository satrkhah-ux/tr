-- App Travluin — public Storage bucket for guide PDFs.
insert into storage.buckets (id, name, public)
values ('guide', 'guide', true)
on conflict (id) do nothing;

-- Anyone may read guide files (they are public download links).
drop policy if exists "guide public read" on storage.objects;
create policy "guide public read" on storage.objects
  for select to public using (bucket_id = 'guide');

-- Authenticated employees may upload / replace / remove guide files.
drop policy if exists "guide authenticated manage" on storage.objects;
create policy "guide authenticated manage" on storage.objects
  for all to authenticated using (bucket_id = 'guide') with check (bucket_id = 'guide');
