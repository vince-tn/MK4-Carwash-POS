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
-- 2. Remove the rows my end-to-end test created
--
-- One order (with its service and add-on rows, removed by cascade) and one
-- worker that could not be deleted before the policy above existed.
------------------------------------------------------------------------------

delete from public.orders where plate_number = 'SELFTEST-DELETE';
delete from public.workers where name = 'ZZ Self Test';
