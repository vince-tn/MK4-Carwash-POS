-- Logins with roles: Admin, Secretary, Worker (client request, 2026-10-03)
--
-- Who can open what:
--   Admin      Dashboard, Sales Records, Employees, Services. Not the Worker
--              Form: admins do not record sales.
--   Secretary  Sales Records and Employees.
--   Worker     The Worker Form only. Sales are recorded under the signed-in
--              worker's own name, whatever the form sends.
-- Everything needs a login now; a signed-out visitor can do nothing.
--
-- How a login gets its role: every employee (public.workers) has a Login
-- email. A signed-in user acts as the ACTIVE employee whose Login email
-- matches theirs, with that employee's role. A login with no such employee
-- can open nothing. Setting someone Inactive therefore also locks them out.
--
-- Existing logins are made Admins so no one is locked out. Starter employees
-- are linked to admin@mk4.pos, secretary@mk4.pos and worker@mk4.pos: create
-- logins with those emails in Authentication -> Users and they work at once.
--
-- The app looks for my_access() to decide whether roles are on. Until this
-- has run it keeps working the old way (public Worker Form, every login an
-- admin), so the app can be deployed first. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Employees: roles and login emails
------------------------------------------------------------------------------

alter table public.workers add column if not exists login_email text;

-- One employee per login.
create unique index if not exists workers_login_email_key
  on public.workers (lower(login_email))
  where login_email is not null;

-- The old job titles map onto the new roles. A role grants nothing without
-- a Login email, so no one gains access from this.
update public.workers
   set role = case
     when role in ('Admin', 'Secretary', 'Worker') then role
     when role = 'Manager' then 'Admin'
     when role = 'Cashier' then 'Secretary'
     else 'Worker'
   end;

alter table public.workers alter column role set default 'Worker';
alter table public.workers alter column role set not null;
alter table public.workers drop constraint if exists workers_role_check;
alter table public.workers
  add constraint workers_role_check check (role in ('Admin', 'Secretary', 'Worker'));

------------------------------------------------------------------------------
-- 2. Who is signed in
------------------------------------------------------------------------------

-- The signed-in user's role in lower case, or null. Used by every policy
-- below, always as (select public.app_role()) so it runs once per query.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(w.role)
    from public.workers w
   where w.status = 'Active'
     and w.login_email is not null
     and lower(w.login_email) = lower(auth.jwt() ->> 'email')
   limit 1;
$$;

revoke all on function public.app_role() from public;
grant execute on function public.app_role() to authenticated;

-- What the app asks on start-up. Signed out, or a login with no active
-- employee, gets role null. Its existence is how the app knows roles are on.
create or replace function public.my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'installed', true,
    'role', lower(w.role),
    'employee_id', w.id,
    'name', w.name
  )
  from (select 1) as always
  left join lateral (
    select e.role, e.id, e.name
      from public.workers e
     where e.status = 'Active'
       and e.login_email is not null
       and lower(e.login_email) = lower(auth.jwt() ->> 'email')
     limit 1
  ) w on true;
$$;

revoke all on function public.my_access() from public;
grant execute on function public.my_access() to anon, authenticated;

------------------------------------------------------------------------------
-- 3. Guard rails on employee records
--
-- Secretaries manage employees, but must not be able to make themselves or
-- anyone else an Admin, nor change or remove an Admin. And no one, admins
-- included, may remove the last Admin who can log in. Changes made in the
-- SQL editor (no signed-in user) are not restricted.
------------------------------------------------------------------------------

create or replace function public.guard_employee_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_was_admin_login boolean := false;
  v_stops_being_one boolean := false;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if v_role is distinct from 'admin' then
    if tg_op <> 'INSERT' then
      if old.role = 'Admin' then
        raise exception 'Only an admin can change or remove an admin.'
          using errcode = '42501';
      end if;
    end if;

    if tg_op <> 'DELETE' then
      if new.role = 'Admin' then
        raise exception 'Only an admin can make someone an admin.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op <> 'INSERT' then
    v_was_admin_login := old.role = 'Admin' and old.status = 'Active'
                         and old.login_email is not null;
  end if;

  if v_was_admin_login then
    if tg_op = 'DELETE' then
      v_stops_being_one := true;
    else
      v_stops_being_one := new.role <> 'Admin'
                           or new.status <> 'Active'
                           or new.login_email is null
                           or lower(new.login_email) <> lower(old.login_email);
    end if;

    if v_stops_being_one and not exists (
      select 1 from public.workers w
       where w.id <> old.id
         and w.role = 'Admin' and w.status = 'Active' and w.login_email is not null
    ) then
      raise exception 'This is the last admin who can log in. Make someone else an admin first.'
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists guard_employee_changes on public.workers;
create trigger guard_employee_changes
  before insert or update or delete on public.workers
  for each row execute function public.guard_employee_changes();

------------------------------------------------------------------------------
-- 4. Access rules
--
-- Every existing policy on these tables goes, including the signed-out ones,
-- and is replaced by role-based ones. Before this, any login could do
-- anything.
------------------------------------------------------------------------------

do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('workers', 'commission_settings', 'orders',
                         'order_services', 'order_addons',
                         'service_categories', 'service_items', 'add_ons')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$$;

-- 11 granted signed-out visitors a few worker columns; they need none now.
revoke select on public.workers from anon;

-- Employees ----------------------------------------------------------------

-- Everyone can read their own record: a worker's commission rule comes from it.
create policy "employees read their own record"
  on public.workers for select to authenticated
  using (
    login_email is not null
    and lower(login_email) = lower((select auth.jwt()) ->> 'email')
  );

create policy "admins and secretaries read employees"
  on public.workers for select to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins and secretaries add employees"
  on public.workers for insert to authenticated
  with check ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins and secretaries edit employees"
  on public.workers for update to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'))
  with check ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins and secretaries remove employees"
  on public.workers for delete to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

-- Commission rule (shown on the Employees page) -----------------------------

create policy "employees read the commission rule"
  on public.commission_settings for select to authenticated
  using ((select public.app_role()) is not null);

create policy "admins and secretaries edit the commission rule"
  on public.commission_settings for update to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'))
  with check ((select public.app_role()) in ('admin', 'secretary'));

-- Price list (Services page; the Worker Form reads it) ----------------------

create policy "employees read service categories"
  on public.service_categories for select to authenticated
  using ((select public.app_role()) is not null);

create policy "admins manage service categories"
  on public.service_categories for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy "employees read service items"
  on public.service_items for select to authenticated
  using ((select public.app_role()) is not null);

create policy "admins manage service items"
  on public.service_items for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy "employees read add-ons"
  on public.add_ons for select to authenticated
  using ((select public.app_role()) is not null);

create policy "admins manage add-ons"
  on public.add_ons for all to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

-- Sales (Sales Records). Workers record them through create_order. ----------

create policy "admins and secretaries read sales"
  on public.orders for select to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins and secretaries edit sales"
  on public.orders for update to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'))
  with check ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins and secretaries delete sales"
  on public.orders for delete to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

-- Only the localStorage import writes orders directly.
create policy "admins import sales"
  on public.orders for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy "admins and secretaries read sale services"
  on public.order_services for select to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins and secretaries delete sale services"
  on public.order_services for delete to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins import sale services"
  on public.order_services for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy "admins and secretaries read sale add-ons"
  on public.order_addons for select to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins and secretaries delete sale add-ons"
  on public.order_addons for delete to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins import sale add-ons"
  on public.order_addons for insert to authenticated
  with check ((select public.app_role()) = 'admin');

-- Payment proofs ------------------------------------------------------------

drop policy if exists "workers can upload payment proofs" on storage.objects;
drop policy if exists "staff can upload payment proofs" on storage.objects;
drop policy if exists "staff can read payment proofs" on storage.objects;
drop policy if exists "staff can delete payment proofs" on storage.objects;
drop policy if exists "workers upload payment proofs" on storage.objects;
drop policy if exists "admins and secretaries view payment proofs" on storage.objects;
drop policy if exists "admins and secretaries delete payment proofs" on storage.objects;

-- Named the way the Worker Form names them: <yyyy-mm-dd>/<uuid>.jpg|png
create policy "workers upload payment proofs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (select public.app_role()) = 'worker'
    and name ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}[.](jpg|png)$'
  );

create policy "admins and secretaries view payment proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (select public.app_role()) in ('admin', 'secretary')
  );

create policy "admins and secretaries delete payment proofs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (select public.app_role()) in ('admin', 'secretary')
  );

------------------------------------------------------------------------------
-- 5. create_order: signed-in workers only, recorded under their own name
--
-- Same as 13 except that it checks the caller and takes worker_id and
-- worker_name from the caller's employee record instead of the payload.
------------------------------------------------------------------------------

create or replace function public.create_order(p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.orders;
  v_day date;
  v_prefix text;
  v_existing integer;
  v_number integer;
  v_sales_order_id text;
  v_id uuid := gen_random_uuid();
  v_created_at timestamptz;
  v_constraint text;
  v_worker_id uuid;
  v_worker_name text;
begin
  select w.id, w.name
    into v_worker_id, v_worker_name
    from public.workers w
   where w.status = 'Active'
     and w.role = 'Worker'
     and w.login_email is not null
     and lower(w.login_email) = lower(auth.jwt() ->> 'email')
   limit 1;

  if v_worker_id is null then
    raise exception 'Only a signed-in worker can record a sale.'
      using errcode = '42501';
  end if;

  v_row := jsonb_populate_record(null::public.orders, p_order);

  if coalesce(btrim(v_row.plate_number), '') = '' then
    raise exception 'A plate number is required.' using errcode = '22023';
  end if;

  -- The shop's calendar day, not the server's (UTC).
  v_day := (now() at time zone 'Asia/Manila')::date;
  v_prefix := 'SO-' || to_char(v_day, 'YYYYMMDD') || '-';

  -- The counter normally decides the number on its own. Taking the highest
  -- number already used today as a floor covers orders written without the
  -- counter. The retry covers one of those landing between the read and the
  -- insert.
  for v_attempt in 1..5 loop
    select coalesce(max((regexp_match(o.sales_order_id, '^SO-[0-9]{8}-([0-9]+)$'))[1]::integer), 0)
      into v_existing
      from public.orders o
     where o.sales_order_id like v_prefix || '%';

    insert into public.sales_order_counters as c (order_day, last_number)
    values (v_day, v_existing + 1)
    on conflict (order_day) do update
      set last_number = greatest(c.last_number, v_existing) + 1
    returning c.last_number into v_number;

    v_sales_order_id :=
      v_prefix || lpad(v_number::text, greatest(3, length(v_number::text)), '0');

    begin
      insert into public.orders (
        id, sales_order_id, order_date, plate_number, customer_name,
        contact_number, car_type, car_brand, worker_id, worker_name, manager,
        service_total, addon_total, cash, gcash, credit, discount,
        payment_enabled, total, total_paid, balance, commission,
        commission_label, gcash_ref, credit_ref, photo_name, photo_path, notes
      )
      values (
        v_id, v_sales_order_id, coalesce(v_row.order_date, v_day),
        v_row.plate_number, v_row.customer_name, v_row.contact_number,
        v_row.car_type, v_row.car_brand, v_worker_id, v_worker_name,
        v_row.manager,
        coalesce(v_row.service_total, 0), coalesce(v_row.addon_total, 0),
        coalesce(v_row.cash, 0), coalesce(v_row.gcash, 0),
        coalesce(v_row.credit, 0), coalesce(v_row.discount, 0),
        coalesce(
          v_row.payment_enabled,
          '{"cash":false,"gcash":false,"credit":false,"discount":false}'::jsonb
        ),
        coalesce(v_row.total, 0), coalesce(v_row.total_paid, 0),
        coalesce(v_row.balance, 0), coalesce(v_row.commission, 0),
        v_row.commission_label, v_row.gcash_ref, v_row.credit_ref,
        v_row.photo_name, v_row.photo_path, v_row.notes
      )
      returning created_at into v_created_at;

      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'orders_sales_order_id_key' or v_attempt = 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.order_services (
    order_id, category, size, price, commission_type, commission_rate,
    commission
  )
  select
    v_id, s.category, coalesce(s.size, ''), coalesce(s.price, 0),
    s.commission_type, coalesce(s.commission_rate, 0), s.commission
  from jsonb_populate_recordset(
    null::public.order_services, coalesce(p_order -> 'services', '[]'::jsonb)
  ) s
  where coalesce(s.category, '') <> '';

  insert into public.order_addons (
    order_id, name, price, commission_rate, commission, details
  )
  select
    v_id, a.name, coalesce(a.price, 0), a.commission_rate, a.commission,
    a.details
  from jsonb_populate_recordset(
    null::public.order_addons, coalesce(p_order -> 'addons', '[]'::jsonb)
  ) a
  where coalesce(a.name, '') <> '';

  return jsonb_build_object(
    'id', v_id,
    'sales_order_id', v_sales_order_id,
    'created_at', v_created_at
  );
end;
$$;

revoke all on function public.create_order(jsonb) from public, anon;
grant execute on function public.create_order(jsonb) to authenticated;

------------------------------------------------------------------------------
-- 6. Starting accounts
------------------------------------------------------------------------------

-- Every login that already exists becomes an Admin, so no one is locked out.
insert into public.workers (name, role, status, login_email, date_joined, notes)
select
  initcap(split_part(u.email, '@', 1)),
  'Admin',
  'Active',
  lower(u.email),
  current_date,
  'Admin login that existed before roles were added (migration 14).'
  from auth.users u
 where u.email is not null
   and not exists (
     select 1 from public.workers w where lower(w.login_email) = lower(u.email)
   );

-- One starter employee per role. Create logins with these emails in
-- Authentication -> Users (tick Auto Confirm User) and they work at once.
-- Rename, re-point or remove them on the Employees page later.
insert into public.workers (name, role, status, login_email, date_joined, notes)
select v.name, v.role, 'Active', v.email, current_date,
       'Starter login. Rename, re-point or remove once real staff are set up.'
  from (values
    ('MK4 Admin', 'Admin', 'admin@mk4.pos'),
    ('MK4 Secretary', 'Secretary', 'secretary@mk4.pos'),
    ('MK4 Worker', 'Worker', 'worker@mk4.pos')
  ) as v(name, role, email)
 where not exists (
   select 1 from public.workers w where lower(w.login_email) = v.email
 );
