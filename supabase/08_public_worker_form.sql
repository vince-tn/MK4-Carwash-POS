-- Public worker form
--
-- Decision: workers record sales without signing in. Admin screens stay
-- behind the login.
--
-- WHAT THIS COSTS, STATED PLAINLY
--
-- The publishable key ships inside the public JavaScript bundle at the
-- deployed URL. Granting anon insert on orders therefore lets anyone who
-- opens the site, reads that key out of the bundle and posts to the REST API
-- write fabricated sales straight into the books. Orders have no delete
-- policy, so anything written that way is permanent.
--
-- Reading sales, editing payments, worker admin and pricing all remain
-- signed-in only, so the exposure is limited to junk being written, not to
-- takings being read.
--
-- If that stops being an acceptable trade, the fix is to delete the three
-- "Public can insert ..." policies below and have the shop tablet stay signed
-- in instead; nothing in the app needs to change for that.
--
-- Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Reads the form needs in order to render
--
-- Worker dropdown, service categories, their sizes and prices, the add-on
-- list, and the commission rule used for the receipt preview.
------------------------------------------------------------------------------

drop policy if exists "Public can read active workers" on public.workers;
create policy "Public can read active workers"
  on public.workers for select to anon, authenticated using (true);

drop policy if exists "Public can read service categories" on public.service_categories;
create policy "Public can read service categories"
  on public.service_categories for select to anon, authenticated using (true);

drop policy if exists "Public can read service items" on public.service_items;
create policy "Public can read service items"
  on public.service_items for select to anon, authenticated using (true);

drop policy if exists "Public can read add ons" on public.add_ons;
create policy "Public can read add ons"
  on public.add_ons for select to anon, authenticated using (true);

drop policy if exists "Public can read commission settings" on public.commission_settings;
create policy "Public can read commission settings"
  on public.commission_settings for select to anon, authenticated using (true);

------------------------------------------------------------------------------
-- 2. Writes submitting the form needs
--
-- Insert only. There is deliberately no anon select on orders: a worker can
-- record a sale but cannot read back the day's takings.
------------------------------------------------------------------------------

drop policy if exists "Authenticated can insert orders" on public.orders;
drop policy if exists "Public can insert orders" on public.orders;
create policy "Public can insert orders"
  on public.orders for insert to anon, authenticated with check (true);

drop policy if exists "Authenticated can insert order services" on public.order_services;
drop policy if exists "Public can insert order services" on public.order_services;
create policy "Public can insert order services"
  on public.order_services for insert to anon, authenticated with check (true);

drop policy if exists "Authenticated can insert order addons" on public.order_addons;
drop policy if exists "Public can insert order addons" on public.order_addons;
create policy "Public can insert order addons"
  on public.order_addons for insert to anon, authenticated with check (true);
