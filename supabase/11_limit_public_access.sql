-- Limit what a signed-out visitor can read and write
--
-- RUN THIS ONLY AFTER THE APP VERSION THAT CALLS create_order IS LIVE.
-- The version before it asks for every worker column and inserts orders
-- directly, and this file refuses both. A worker's tab still open on the old
-- version will show an empty worker list until it is reloaded.
--
-- 1. Worker phone numbers and home addresses were readable by anyone holding
--    the publishable key, which ships in the public JavaScript bundle. 08 had
--    widened the original "active workers" read to every row and every
--    column. Signed-out visitors now see active workers only, and only the
--    columns the Worker Form uses.
--
-- 2. Signed-out sales go through create_order (10). The direct anon inserts
--    on orders and their child rows are no longer needed. They also let
--    anyone attach service rows to any existing order, so they go. Signed-in
--    staff keep direct inserts for the localStorage import, which must keep
--    each order's original number.
--
-- Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Workers: active rows, form columns only
------------------------------------------------------------------------------

drop policy if exists "Public can read active workers" on public.workers;
create policy "Public can read active workers"
  on public.workers for select to anon
  using (status = 'Active');

-- Column privileges, because RLS filters rows, not columns.
revoke select on public.workers from anon;
grant select (id, name, role, status, commission_mode, commission_value)
  on public.workers to anon;

------------------------------------------------------------------------------
-- 2. Orders: anon writes only through create_order
------------------------------------------------------------------------------

drop policy if exists "Public can insert orders" on public.orders;
drop policy if exists "Authenticated can insert orders" on public.orders;
create policy "Authenticated can insert orders"
  on public.orders for insert to authenticated with check (true);

drop policy if exists "Public can insert order services" on public.order_services;
drop policy if exists "Authenticated can insert order services" on public.order_services;
create policy "Authenticated can insert order services"
  on public.order_services for insert to authenticated with check (true);

drop policy if exists "Public can insert order addons" on public.order_addons;
drop policy if exists "Authenticated can insert order addons" on public.order_addons;
create policy "Authenticated can insert order addons"
  on public.order_addons for insert to authenticated with check (true);
