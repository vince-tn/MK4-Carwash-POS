-- Payment proof image storage
--
-- Photo Proof images are compressed to roughly 300 KB in the browser before
-- upload. The bucket is PRIVATE: Sales Records opens each image through a
-- short-lived signed URL, so proofs are never on a public link.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Uploads will fail until this exists. Safe to re-run.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  2097152, -- 2 MB hard ceiling; the browser compresses to ~300 KB first
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Only signed-in staff can add or read proofs. No update or delete policy is
-- granted, so a proof cannot be altered or erased from inside the app.
drop policy if exists "staff can upload payment proofs" on storage.objects;
create policy "staff can upload payment proofs"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'payment-proofs');

drop policy if exists "staff can read payment proofs" on storage.objects;
create policy "staff can read payment proofs"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'payment-proofs');
