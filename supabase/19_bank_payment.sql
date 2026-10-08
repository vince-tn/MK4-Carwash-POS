-- Bank transfer as a payment method (client request, 2026-10-08)
--
-- The shop takes bank transfers (the "Total BDO" line on the owner's sheet)
-- and had nowhere to record them, so they were going in as cash or not at all.
--
-- 1. orders gains a bank amount and a bank reference, matching what GCash and
--    Credit already have. A bank transfer has a reference number and staff
--    need somewhere to put it.
-- 2. payment_enabled gains a "bank" flag. Rows written before this simply have
--    no "bank" key; every read coalesces a missing key to false, so existing
--    sales are untouched and still total exactly as they do today.
-- 3. create_order writes both. It is otherwise character for character the
--    version from 18, lifted from that file rather than retyped.
--
-- RUN THIS BEFORE DEPLOYING THE APP VERSION THAT SHOWS THE BANK OPTION.
-- It is additive and the version live today ignores both columns, so applying
-- it early changes nothing. Deploying the app first would mean the app sends a
-- bank amount that the database silently drops, and the sale's totals would be
-- wrong. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------

alter table public.orders add column if not exists bank numeric default 0;
alter table public.orders add column if not exists bank_ref text;

-- New sales get the flag; existing rows keep whatever they already have.
alter table public.orders
  alter column payment_enabled
  set default '{"cash":false,"gcash":false,"credit":false,"bank":false,"discount":false}'::jsonb;

------------------------------------------------------------------------------
-- 2. create_order records a bank payment
--
-- Identical to 18 apart from the bank amount, the bank reference and the
-- payment_enabled default.
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
  v_role text := public.app_role();
begin
  v_row := jsonb_populate_record(null::public.orders, p_order);

  if v_role = 'secretary' then
    -- A secretary records for any active worker, and always says which.
    if v_row.worker_id is null then
      raise exception 'Choose which worker did this car.'
        using errcode = '22023';
    end if;

    select w.id, w.name
      into v_worker_id, v_worker_name
      from public.workers w
     where w.id = v_row.worker_id
       and w.status = 'Active'
       and w.role = 'Worker';

    if v_worker_id is null then
      raise exception 'That worker is not an active worker.'
        using errcode = '42501';
    end if;
  else
    -- A worker login, exactly as in 15.
    select count(*)
      into v_on_login
      from public.workers w
     where w.status = 'Active'
       and w.role = 'Worker'
       and w.login_email is not null
       and lower(w.login_email) = lower(auth.jwt() ->> 'email');

    if v_on_login = 0 then
      raise exception 'Only a signed-in worker or secretary can record a sale.'
        using errcode = '42501';
    end if;

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
        service_total, addon_total, cash, gcash, credit, bank, discount,
        payment_enabled, total, total_paid, balance, commission,
        commission_label, gcash_ref, credit_ref, bank_ref,
        photo_name, photo_path, notes
      )
      values (
        v_id, v_sales_order_id, coalesce(v_row.order_date, v_day),
        v_row.plate_number, v_row.customer_name, v_row.contact_number,
        v_row.car_type, v_row.car_brand, v_worker_id, v_worker_name,
        v_row.manager,
        coalesce(v_row.service_total, 0), coalesce(v_row.addon_total, 0),
        coalesce(v_row.cash, 0), coalesce(v_row.gcash, 0),
        coalesce(v_row.credit, 0), coalesce(v_row.bank, 0),
        coalesce(v_row.discount, 0),
        coalesce(
          v_row.payment_enabled,
          '{"cash":false,"gcash":false,"credit":false,"bank":false,"discount":false}'::jsonb
        ),
        coalesce(v_row.total, 0), coalesce(v_row.total_paid, 0),
        coalesce(v_row.balance, 0), coalesce(v_row.commission, 0),
        v_row.commission_label, v_row.gcash_ref, v_row.credit_ref,
        v_row.bank_ref,
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
