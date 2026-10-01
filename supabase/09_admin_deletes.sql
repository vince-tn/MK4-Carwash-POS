-- Admin deletions: sales orders, and workers who already have sales
--
-- Two changes, both at the shop's request:
--
-- 1. Signed-in staff can delete a sales order. Until now a mis-keyed sale was
--    permanent and could only be removed with SQL, which a cashier does not
--    have. The app asks for confirmation first and shows the amount.
--
-- 2. Deleting a worker also deletes that worker's sales.
--
-- READ THIS BEFORE RUNNING, because point 2 is not reversible: orders.worker_id
-- becomes ON DELETE CASCADE, so removing a worker destroys every sale recorded
-- against them, and the shop's totals for past days change accordingly. The app
-- warns and shows how many sales and what value will go, but once confirmed
-- there is no undo.
--
-- The gentler alternative, if that is ever the wrong trade: use ON DELETE SET
-- NULL instead. Orders store worker_name as plain text, so the sales and the
-- worker's name on them survive and only the link is dropped. Setting a worker
-- to Inactive also keeps them out of the dropdown without touching history.
--
-- Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Let staff delete a sales order
------------------------------------------------------------------------------

drop policy if exists "Authenticated can delete orders" on public.orders;
create policy "Authenticated can delete orders"
  on public.orders for delete to authenticated using (true);

------------------------------------------------------------------------------
-- 2. Deleting a worker takes their sales with them
--
-- Previously this foreign key had no action clause, so Postgres refused the
-- delete outright and the app had to block it in the UI.
------------------------------------------------------------------------------

alter table public.orders
  drop constraint if exists orders_worker_id_fkey;

alter table public.orders
  add constraint orders_worker_id_fkey
  foreign key (worker_id) references public.workers(id) on delete cascade;
