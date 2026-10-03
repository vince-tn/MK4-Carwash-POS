-- Shared logins for workers and secretaries (client decision, 2026-10-03)
--
-- All workers sign in with one shared login (worker@mk4.pos) and all
-- secretaries with another (secretary@mk4.pos). Admins keep their own.
-- 14 assumed one login per employee; this lets several employees share one.
--
-- 1. Several employees may share a Login email. A shared login's role is the
--    role of the employees on it, so everyone on one login must have the
--    same role.
-- 2. A Worker or Secretary saved without a Login email gets the shared one
--    for their role, and an employee moved to another role moves to that
--    role's shared login. The shared emails live in public.role_logins.
-- 3. On a shared worker login the Worker Form asks who did the car, and the
--    sale is recorded under that worker. create_order accepts only workers on
--    the signed-in login. A login with a single worker still records under
--    that worker without asking.
-- 4. Workers no longer read the employees table directly: on a shared login
--    that would hand every coworker's phone and address to every worker.
--    my_employees() returns only what the Worker Form needs.
-- 5. Existing Workers and Secretaries without a login are put on the shared
--    one. The "MK4 Worker" starter is set Inactive: on a shared login it
--    would only be an extra name on the form.
--
-- The app deployed with this falls back to the 14 behavior until it finds
-- my_employees(), so it can go out first. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Shared login per role
------------------------------------------------------------------------------

create table if not exists public.role_logins (
  role text primary key check (role in ('Secretary', 'Worker')),
  email text not null
);

alter table public.role_logins enable row level security;
revoke all on public.role_logins from anon, authenticated;

insert into public.role_logins (role, email)
values ('Worker', 'worker@mk4.pos'), ('Secretary', 'secretary@mk4.pos')
on conflict (role) do nothing;

-- Logins may now be shared, so the one-employee-per-login index goes.
drop index if exists public.workers_login_email_key;
create index if not exists workers_login_email_idx
  on public.workers (lower(login_email));

------------------------------------------------------------------------------
-- 2. Fill in the shared login, and keep one role per login
--
-- Fires before guard_employee_changes (triggers run in name order), so the
-- guard sees the final login email.
------------------------------------------------------------------------------

create or replace function public.fill_shared_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shared text;
  v_old_shared text;
begin
  select r.email into v_shared from public.role_logins r where r.role = new.role;

  if new.login_email is null or btrim(new.login_email) = '' then
    new.login_email := v_shared;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      select r.email into v_old_shared from public.role_logins r where r.role = old.role;

      -- Moved off a shared login with the role change. Null for Admin: an
      -- admin needs a login of their own.
      if lower(new.login_email) = lower(v_old_shared) then
        new.login_email := v_shared;
      end if;
    end if;
  end if;

  if new.login_email is not null then
    new.login_email := lower(btrim(new.login_email));

    if exists (
      select 1 from public.workers w
       where w.id <> new.id
         and lower(w.login_email) = new.login_email
         and w.role <> new.role
    ) then
      raise exception 'The login % already belongs to employees with another role. Everyone on one login must have the same role.', new.login_email
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists fill_shared_login on public.workers;
create trigger fill_shared_login
  before insert or update on public.workers
  for each row execute function public.fill_shared_login();

------------------------------------------------------------------------------
-- 3. Who is signed in, with shared logins
------------------------------------------------------------------------------

-- shared: more than one active employee on this login. name is the
-- employee's for a personal login, and "Worker login" or "Secretary login"
-- for a shared one.
create or replace function public.my_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select e.id, e.name, e.role
      from public.workers e
     where e.status = 'Active'
       and e.login_email is not null
       and lower(e.login_email) = lower(auth.jwt() ->> 'email')
  )
  select jsonb_build_object(
    'installed', true,
    'role', (select (array_agg(lower(m.role)))[1] from mine m),
    'shared', (select count(*) from mine) > 1,
    'employee_id', (
      select case when count(*) = 1 then (array_agg(m.id))[1] end from mine m
    ),
    'name', (
      select case
        when count(*) = 1 then (array_agg(m.name))[1]
        when count(*) > 1 then (array_agg(m.role))[1] || ' login'
      end
      from mine m
    )
  );
$$;

revoke all on function public.my_access() from public;
grant execute on function public.my_access() to anon, authenticated;

-- The active employees on the signed-in login, with only what the Worker
-- Form needs.
create or replace function public.my_employees()
returns table (
  id uuid,
  name text,
  role text,
  status text,
  commission_mode text,
  commission_value numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.role, w.status, w.commission_mode, w.commission_value
    from public.workers w
   where w.status = 'Active'
     and w.login_email is not null
     and lower(w.login_email) = lower(auth.jwt() ->> 'email')
   order by w.name;
$$;

revoke all on function public.my_employees() from public;
grant execute on function public.my_employees() to authenticated;

-- my_employees() replaces this: on a shared login it would expose every
-- coworker's full record.
drop policy if exists "employees read their own record" on public.workers;

------------------------------------------------------------------------------
-- 4. create_order: the chosen worker, if they are on this login
--
-- Same as 14 except for how the worker is decided: the form's worker_id if
-- that worker is active and on the signed-in login; otherwise the login's
-- only worker; otherwise the sale is refused until a worker is chosen.
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
  v_on_login integer;
begin
  select count(*)
    into v_on_login
    from public.workers w
   where w.status = 'Active'
     and w.role = 'Worker'
     and w.login_email is not null
     and lower(w.login_email) = lower(auth.jwt() ->> 'email');

  if v_on_login = 0 then
    raise exception 'Only a signed-in worker can record a sale.'
      using errcode = '42501';
  end if;

  v_row := jsonb_populate_record(null::public.orders, p_order);

  if v_row.worker_id is not null then
    select w.id, w.name
      into v_worker_id, v_worker_name
      from public.workers w
     where w.id = v_row.worker_id
       and w.status = 'Active'
       and w.role = 'Worker'
       and lower(w.login_email) = lower(auth.jwt() ->> 'email');

    if v_worker_id is null then
      raise exception 'That worker is not on this login.'
        using errcode = '42501';
    end if;
  elsif v_on_login = 1 then
    select w.id, w.name
      into v_worker_id, v_worker_name
      from public.workers w
     where w.status = 'Active'
       and w.role = 'Worker'
       and lower(w.login_email) = lower(auth.jwt() ->> 'email');
  else
    raise exception 'Choose which worker did this car.'
      using errcode = '22023';
  end if;

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
-- 5. Put existing staff on the shared logins
------------------------------------------------------------------------------

update public.workers w
   set login_email = r.email
  from public.role_logins r
 where r.role = w.role
   and (w.login_email is null or btrim(w.login_email) = '');

update public.workers
   set status = 'Inactive',
       notes = 'Starter placeholder, set Inactive by migration 15: workers share worker@mk4.pos and choose their own name on the Worker Form. Safe to delete.'
 where name = 'MK4 Worker'
   and lower(login_email) = 'worker@mk4.pos'
   and notes like 'Starter login%';
