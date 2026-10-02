-- Save a sale in one step, numbered by the database
--
-- Three problems with recording a sale from the browser, all fixed here:
--
-- 1. Sales were being refused. The sales order number was "orders loaded on
--    this device + 1", and a signed-out worker cannot read orders, so every
--    device started at SO-<date>-001. sales_order_id is unique, so after the
--    first sale of the day any reload, new tab or second device had every
--    sale rejected with a duplicate key error. The number is now handed out
--    here, from a per-day counter, under a row lock.
--
-- 2. A sale was three separate writes (the order, then its services, then its
--    add-ons). A failure in between left an order with nothing under it, and
--    a retry saved the sale twice. One function call is one transaction.
--
-- 3. Signed-out workers could not attach a payment proof: the bucket only
--    accepted uploads from signed-in staff. They can now upload, and only
--    upload, files named the way the app names them.
--
-- Additive only. The app version live when this was written does not call
-- create_order, so applying this changes nothing until the matching app
-- version ships. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Per-day counter
--
-- No policies: only create_order, which runs as the table owner, touches it.
------------------------------------------------------------------------------

create table if not exists public.sales_order_counters (
  order_day date primary key,
  last_number integer not null
);

alter table public.sales_order_counters enable row level security;
revoke all on public.sales_order_counters from anon, authenticated;

------------------------------------------------------------------------------
-- 2. create_order
--
-- Takes the order row in the table's own column names, plus "services" and
-- "addons" arrays shaped like order_services / order_addons rows. Returns the
-- new row's id, its sales order number and created_at.
--
-- SECURITY DEFINER because the next number depends on orders that a
-- signed-out worker is not allowed to read. It writes nothing the anon insert
-- policies did not already allow, and returns only the new sale's number.
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
    order_id, category, size, price, commission_type, commission_rate
  )
  select
    v_id, s.category, coalesce(s.size, ''), coalesce(s.price, 0),
    s.commission_type, coalesce(s.commission_rate, 0)
  from jsonb_populate_recordset(
    null::public.order_services, coalesce(p_order -> 'services', '[]'::jsonb)
  ) s
  where coalesce(s.category, '') <> '';

  insert into public.order_addons (order_id, name, price)
  select v_id, a.name, coalesce(a.price, 0)
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

------------------------------------------------------------------------------
-- 3. Signed-out workers may upload a payment proof
--
-- Insert only: they still cannot list, open or delete proofs. The name must
-- match what WorkerForm generates (<yyyy-mm-dd>/<uuid>.jpg|png), and the
-- bucket's own 2 MB and image-only limits still apply.
------------------------------------------------------------------------------

drop policy if exists "workers can upload payment proofs" on storage.objects;
create policy "workers can upload payment proofs"
  on storage.objects for insert to anon
  with check (
    bucket_id = 'payment-proofs'
    and name ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}[.](jpg|png)$'
  );
