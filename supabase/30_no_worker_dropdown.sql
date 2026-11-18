-- The Worker Form no longer asks for "the worker" (client, 2026-11-18)
--
-- Who did a car is now said service by service (and package detail by
-- package detail, add-on by add-on, 25), so the client asked for the single
-- Worker dropdown at the top of the form to go. A sale still has its own
-- worker (orders.worker_id, worker_name): Sales Records sorts by it, adding
-- to a sale starts from it, and a flat per-order amount is paid with it.
--
-- create_order, sent no worker, now takes the first worker credited on the
-- sale (the first service's, else the first add-on's):
--   - a secretary's sale: the first active worker credited;
--   - a worker login's sale: the first credited worker who is on that login.
--     At least one worker on the login must have worked on the car, as the
--     sale's worker always had to be (15): the shared tablet can still credit
--     a helper with a login of their own, but not record a car only others
--     did.
-- Sent a worker (the app before this), it works exactly as in 25.
--
-- Nothing already recorded changes. RUN THIS BEFORE DEPLOYING THE APP
-- VERSION WITHOUT THE WORKER DROPDOWN: that version sends no worker, which
-- 25 refuses. The version on staging until then keeps working after this.
-- Run once. Safe to re-run.

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
  v_lines record;
  v_rest numeric;
begin
  v_row := jsonb_populate_record(null::public.orders, p_order);

  if v_role = 'secretary' then
    -- A secretary records for any active worker. Sent no worker (the app
    -- from 30 on), the sale's worker is the first one credited.
    if v_row.worker_id is null then
      select w.id, w.name
        into v_worker_id, v_worker_name
        from (
          select s_c.value ->> 'worker_id' as id, s.ord * 1000 + s_c.ord as n
            from jsonb_array_elements(
                   case when jsonb_typeof(p_order -> 'services') = 'array' then p_order -> 'services' else '[]'::jsonb end
                 ) with ordinality as s(value, ord)
           cross join lateral jsonb_array_elements(
                   case when jsonb_typeof(s.value -> 'credits') = 'array' then s.value -> 'credits' else '[]'::jsonb end
                 ) with ordinality as s_c(value, ord)
          union all
          select a_c.value ->> 'worker_id', 1000000 + a.ord * 1000 + a_c.ord
            from jsonb_array_elements(
                   case when jsonb_typeof(p_order -> 'addons') = 'array' then p_order -> 'addons' else '[]'::jsonb end
                 ) with ordinality as a(value, ord)
           cross join lateral jsonb_array_elements(
                   case when jsonb_typeof(a.value -> 'credits') = 'array' then a.value -> 'credits' else '[]'::jsonb end
                 ) with ordinality as a_c(value, ord)
        ) x
        join public.workers w on w.id = nullif(x.id, '')::uuid
       where w.status = 'Active'
         and w.role = 'Worker'
       order by x.n
       limit 1;

      if v_worker_id is null then
        raise exception 'Choose who did each service.'
          using errcode = '22023';
      end if;
    else
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
    else
      -- Sent no worker: the first one credited who is on this login. At
      -- least one worker on the login must have worked on the car, as the
      -- sale's worker always had to be (15).
      select w.id, w.name
        into v_worker_id, v_worker_name
        from (
          select s_c.value ->> 'worker_id' as id, s.ord * 1000 + s_c.ord as n
            from jsonb_array_elements(
                   case when jsonb_typeof(p_order -> 'services') = 'array' then p_order -> 'services' else '[]'::jsonb end
                 ) with ordinality as s(value, ord)
           cross join lateral jsonb_array_elements(
                   case when jsonb_typeof(s.value -> 'credits') = 'array' then s.value -> 'credits' else '[]'::jsonb end
                 ) with ordinality as s_c(value, ord)
          union all
          select a_c.value ->> 'worker_id', 1000000 + a.ord * 1000 + a_c.ord
            from jsonb_array_elements(
                   case when jsonb_typeof(p_order -> 'addons') = 'array' then p_order -> 'addons' else '[]'::jsonb end
                 ) with ordinality as a(value, ord)
           cross join lateral jsonb_array_elements(
                   case when jsonb_typeof(a.value -> 'credits') = 'array' then a.value -> 'credits' else '[]'::jsonb end
                 ) with ordinality as a_c(value, ord)
        ) x
        join public.workers w on w.id = nullif(x.id, '')::uuid
       where w.status = 'Active'
         and w.role = 'Worker'
         and lower(w.login_email) = lower(auth.jwt() ->> 'email')
       order by x.n
       limit 1;

      -- The app before 30 on a login of one worker's own sends no credits.
      if v_worker_id is null and v_on_login = 1 and not (p_order ? 'sale_credits') then
        select w.id, w.name
          into v_worker_id, v_worker_name
          from public.workers w
         where w.status = 'Active'
           and w.role = 'Worker'
           and lower(w.login_email) = lower(auth.jwt() ->> 'email');
      end if;

      if v_worker_id is null then
        raise exception 'At least one worker on this login must have worked on this car.'
          using errcode = '42501';
      end if;
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

  select * into v_lines
    from public.record_sale_lines(
      v_id, v_worker_id, v_worker_name,
      p_order -> 'services', p_order -> 'addons', p_order -> 'sale_credits', null
    );

  -- The app live before 25 sends no sale_credits; a flat per-order amount
  -- is then whatever its commission is above its lines', and goes to the
  -- sale's worker.
  if not (p_order ? 'sale_credits') then
    v_rest := round(coalesce(v_row.commission, 0) - v_lines.commission, 2);

    if v_rest > 0 then
      insert into public.order_credits (
        order_id, kind, worker_id, worker_name, share, sales_amount,
        commission, rule_label
      )
      values (v_id, 'sale', v_worker_id, v_worker_name, 1, 0, v_rest, v_row.commission_label);

      v_lines.commission := v_lines.commission + v_rest;
    end if;
  end if;

  -- Total, Paid and Balance follow (recompute_order_paid, 24).
  update public.orders o
     set service_total = v_lines.service_total,
         addon_total = v_lines.addon_total,
         commission = v_lines.commission
   where o.id = v_id;

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
-- Check the work
------------------------------------------------------------------------------

do $$
begin
  if position('first one credited' in pg_get_functiondef('public.create_order(jsonb)'::regprocedure)) = 0 then
    raise exception 'create_order was not updated.';
  end if;

  if has_function_privilege('anon', 'public.create_order(jsonb)', 'execute') then
    raise exception 'Visitors must not record sales.';
  end if;

  if not has_function_privilege('authenticated', 'public.create_order(jsonb)', 'execute') then
    raise exception 'Signed-in staff must be able to call create_order (it checks roles itself).';
  end if;
end $$;
