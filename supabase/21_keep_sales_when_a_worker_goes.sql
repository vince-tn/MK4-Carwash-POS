-- Deleting a worker no longer destroys their sales (client, 2026-10-09)
--
-- 09 made orders.worker_id ON DELETE CASCADE, so removing an employee removed
-- every sale they had recorded. After 20 that was the only way left to lose a
-- sale: the app cannot delete one, but a cascade is enforced by the foreign
-- key rather than by a policy, so dropping the delete policy never touched it.
--
-- The link is now ON DELETE SET NULL. Removing an employee clears worker_id on
-- their sales and leaves everything else exactly as it is. Nothing is lost and
-- the books do not move:
--   - orders.worker_name is plain text and is not touched, so Sales Records,
--     the Worker Reports per-worker table and the dashboard charts all still
--     show the sale under the name of whoever did the car.
--   - The per-employee totals on the Employees page are keyed on worker_id, so
--     a departed employee's sales stop counting towards an employee who no
--     longer exists. That is the intent.
--   - Payment proofs are untouched.
--
-- Setting someone Inactive is still the better move for a worker who has left:
-- it keeps the link as well as the sales, and removes their access.
--
-- RUN THIS BEFORE DEPLOYING THE APP VERSION THAT SAYS SALES ARE KEPT, so the
-- warning the app shows and what the database does can never disagree. It is
-- additive in effect -- no row is read or written, only the rule for a future
-- delete changes. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Re-point the foreign key
------------------------------------------------------------------------------

alter table public.orders drop constraint if exists orders_worker_id_fkey;

alter table public.orders
  add constraint orders_worker_id_fkey
  foreign key (worker_id) references public.workers(id) on delete set null;

------------------------------------------------------------------------------
-- 2. Prove it took
--
-- confdeltype: 'c' cascade, 'n' set null, 'a' no action, 'r' restrict.
-- 20 taught the lesson: a migration that reports success is not the same as a
-- migration that did what it said, so this fails loudly if the rule is wrong.
------------------------------------------------------------------------------

do $$
declare
  v_action "char";
begin
  select c.confdeltype into v_action
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'orders'
     and c.conname = 'orders_worker_id_fkey';

  if v_action is distinct from 'n' then
    raise exception
      'orders_worker_id_fkey is not ON DELETE SET NULL (found %). Deleting a worker could still destroy their sales.',
      coalesce(v_action::text, 'no such constraint');
  end if;
end $$;
