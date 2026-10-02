-- Add-on commissions and worker-priced labor (client feedback, 2026-10-02)
--
-- 1. Every add-on carries its own commission percentage, set by the admin on
--    Services -> Add-on Pricing. A worker earns it on top of their service
--    commission. Add-ons left at 0% earn nothing.
-- 2. "Labor Only" is the one add-on whose price the worker types in, along
--    with a description of the labor done. The admin's price is only the
--    default, and the commission is the add-on's percentage of what the
--    worker entered.
-- 3. Each sale now records the commission earned on every service and
--    add-on line, so Sales Records can show the breakdown and not only the
--    total. Sales recorded before this keep their total only.
--
-- Additive: the app version live when this was written ignores every new
-- column, so apply this BEFORE deploying the version that uses them.
-- Run once. Re-running leaves admin-edited rates alone, except that a rate an
-- admin has set back to 0 gets the client's starting value again.

------------------------------------------------------------------------------
-- 1. Add-on settings
------------------------------------------------------------------------------

alter table public.add_ons
  add column if not exists commission_rate numeric not null default 0;

-- True for add-ons whose price the worker enters per sale. Choosing one
-- clears the other add-ons on the Worker Form.
alter table public.add_ons
  add column if not exists worker_sets_price boolean not null default false;

-- The client's starting rates. Ms. Millet can change them on the Services page.
update public.add_ons set commission_rate = 12
 where name in ('Wheel Decontamination', 'Back to Zero', 'Labor Only')
   and commission_rate = 0;
update public.add_ons set commission_rate = 30
 where name in ('Spray', 'Machine')
   and commission_rate = 0;
update public.add_ons set worker_sets_price = true
 where name = 'Labor Only';

------------------------------------------------------------------------------
-- 2. Per-line commission on each sale
--
-- Null on lines recorded before this migration, which is how the app tells
-- an old sale (total only) from a new one (full breakdown).
------------------------------------------------------------------------------

alter table public.order_services add column if not exists commission numeric;

alter table public.order_addons add column if not exists commission_rate numeric;
alter table public.order_addons add column if not exists commission numeric;
-- What labor was done, for a worker-priced add-on such as Labor Only.
alter table public.order_addons add column if not exists details text;

------------------------------------------------------------------------------
-- 3. create_order writes the new columns
--
-- Same as 10 except for the two child-row inserts. A payload without the new
-- keys (the app version before this) stores nulls in them, as before.
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
begin
  v_row := jsonb_populate_record(null::public.orders, p_order);

  if coalesce(btrim(v_row.plate_number), '') = '' then
    raise exception 'A plate number is required.' using errcode = '22023';
  end if;

  -- The shop's calendar day, not the server's (UTC).
  v_day := (now() at time zone 'Asia/Manila')::date;
  v_prefix := 'SO-' || to_char(v_day, 'YYYYMMDD') || '-';

  -- The counter normally decides the number on its own. Taking the highest
  -- number already used today as a floor covers orders written without the
  -- counter: by the previous app version, or before this migration ran.
  -- The retry covers one of those landing between the read and the insert.
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
        v_row.car_type, v_row.car_brand, v_row.worker_id, v_row.worker_name,
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

revoke all on function public.create_order(jsonb) from public;
grant execute on function public.create_order(jsonb) to anon, authenticated;
