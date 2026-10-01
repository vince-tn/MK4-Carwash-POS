-- Worker deletion policy, plus removal of the rows left by my testing
--
-- The Workers page has a Delete button, but 02 Policies only granted insert,
-- select and update on public.workers. Postgres reports a delete with no
-- matching policy as success affecting zero rows, so the worker disappeared
-- from the screen and reappeared on the next reload. db.js now inspects the
-- affected rows, and this adds the policy the button always needed.
--
-- Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Let staff delete a worker
--
-- Orders keep worker_name as plain text, so sales history survives a worker
-- being removed, and the app already refuses to delete anyone who has orders.
------------------------------------------------------------------------------

drop policy if exists "Authenticated can delete workers" on public.workers;
create policy "Authenticated can delete workers"
  on public.workers for delete to authenticated using (true);

------------------------------------------------------------------------------
-- 2. Let staff remove a proof image
--
-- payment_proofs.sql granted insert and select but not delete, and the
-- storage API reports a blocked delete as success having removed nothing.
-- Without this there is no way to clear old proofs, and the 1 GB storage
-- quota can only ever fill up.
------------------------------------------------------------------------------

drop policy if exists "staff can delete payment proofs" on storage.objects;
create policy "staff can delete payment proofs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs');

------------------------------------------------------------------------------
-- 3. Remove the rows my end-to-end test created
--
-- One order (with its service and add-on rows, removed by cascade) and one
-- worker that could not be deleted before the policy above existed.
------------------------------------------------------------------------------

delete from public.orders where plate_number = 'SELFTEST-DELETE';
delete from public.workers where name = 'ZZ Self Test';
