-- Fixes for Supabase's Security and Performance Advisors (2026-10-04)
--
-- 1. "Public can execute SECURITY DEFINER function". Supabase grants every new
--    function to signed-out visitors by default. None of these returns
--    anything to them, but none needs to be callable either:
--      my_access, my_employees, app_role: signed-in users only. The app reads
--        a refused my_access as "roles are on, nobody signed in".
--      fill_shared_login, guard_employee_changes: trigger functions, which
--        nobody needs to call directly. Postgres checks EXECUTE on a trigger
--        function only when the trigger is created, so they keep firing.
--    create_order, my_access, my_employees and app_role stay callable by
--    signed-in users: the app and the access rules depend on them. The
--    advisor keeps listing those four as intended exceptions.
--
-- 2. "Multiple permissive policies" on the price list. For an admin, every
--    read checked both "employees read ..." and "admins manage ..." (FOR ALL
--    includes SELECT). Admins' rule now covers only writes, so each read
--    checks one rule.
--
-- Deploy the app version that reads a refused my_access first (it is out
-- before this file). Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Function access
------------------------------------------------------------------------------

revoke execute on function public.my_access() from public, anon;
revoke execute on function public.my_employees() from public, anon;
revoke execute on function public.app_role() from public, anon;

revoke execute on function public.fill_shared_login() from public, anon, authenticated;
revoke execute on function public.guard_employee_changes() from public, anon, authenticated;

------------------------------------------------------------------------------
-- 2. One read rule per price-list table
------------------------------------------------------------------------------

drop policy if exists "admins manage service categories" on public.service_categories;
drop policy if exists "admins add service categories" on public.service_categories;
drop policy if exists "admins edit service categories" on public.service_categories;
drop policy if exists "admins remove service categories" on public.service_categories;

create policy "admins add service categories"
  on public.service_categories for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy "admins edit service categories"
  on public.service_categories for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy "admins remove service categories"
  on public.service_categories for delete to authenticated
  using ((select public.app_role()) = 'admin');

drop policy if exists "admins manage service items" on public.service_items;
drop policy if exists "admins add service items" on public.service_items;
drop policy if exists "admins edit service items" on public.service_items;
drop policy if exists "admins remove service items" on public.service_items;

create policy "admins add service items"
  on public.service_items for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy "admins edit service items"
  on public.service_items for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy "admins remove service items"
  on public.service_items for delete to authenticated
  using ((select public.app_role()) = 'admin');

drop policy if exists "admins manage add-ons" on public.add_ons;
drop policy if exists "admins add add-ons" on public.add_ons;
drop policy if exists "admins edit add-ons" on public.add_ons;
drop policy if exists "admins remove add-ons" on public.add_ons;

create policy "admins add add-ons"
  on public.add_ons for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy "admins edit add-ons"
  on public.add_ons for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy "admins remove add-ons"
  on public.add_ons for delete to authenticated
  using ((select public.app_role()) = 'admin');
