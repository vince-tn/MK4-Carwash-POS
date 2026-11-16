-- Several workers on one car, and add-ons more than once
-- (client revision, 2026-11-13)
--
-- One car is often worked on by several people: one does the interior,
-- another the exterior, a third the engine. Until now a sale had one worker,
-- who earned all of its commission. Now:
--
-- 1. public.service_processes: a service (a price-list category) can have
--    package details (called steps below), for example Full Package ->
--    Interior, Exterior, Engine, Glass, each with a share of the service's
--    commission. Shares of 0 everywhere mean an equal split; otherwise the
--    Services page only saves shares adding up to 100%. A service without
--    details can still be done by several workers, who split it equally.
--    Admins edit them on Services ("Package Details").
-- 2. order_addons.qty and unit_price: an add-on can be had more than once
--    (2x Mr Pink). price stays the line's whole amount (unit_price x qty), so
--    every total and report that reads price is unchanged.
-- 3. public.order_credits: who earns what on each sale, one row per worker
--    per service (or step), per add-on, and per flat per-order amount. kind
--    'sale' is commission that belongs to the sale as a whole: a flat
--    per-order amount, or, on sales recorded before 13 stored commission per
--    line, all of it. A sale's credits always add up to its commission. Every
--    report that splits commission by worker reads these from now on.
--    Every sale already recorded gets credits for its one worker, so nothing
--    any report shows for it changes.
-- 4. public.active_workers(): the active workers, for choosing who helped on
--    a car. A personal worker login could only see itself until now.
-- 5. create_order and add_to_sale record each line's credits. The app works
--    out each worker's commission under their own rule (lib/commission), as
--    it always has; the database checks the workers are active, the shares
--    add up, and no amount is below zero, then sets the line's and the sale's
--    commission and totals from what was stored. Sent without credits (the
--    app live today), every line is credited to the sale's worker exactly as
--    before.
--
-- Nothing here changes a sale's figures: its Total, Paid, Balance and
-- commission stay exactly as they are, and the check at the end fails if any
-- sale's credits do not add up to its commission.
--
-- RUN THIS BEFORE DEPLOYING THE APP VERSION WITH SEVERAL WORKERS PER SALE:
-- that version reads order_credits and service_processes, and its reports
-- would fail to load without them. The version live today keeps working
-- after this runs: its sales are credited to their one worker. Run once.
-- Safe to re-run.

------------------------------------------------------------------------------
-- 1. Service steps
------------------------------------------------------------------------------

create table if not exists public.service_processes (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  share_percent numeric not null default 0 check (share_percent >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- No unique name per service: the Services page saves as the admin types,
-- and two steps briefly sharing a name must not fail the save.
create index if not exists service_processes_category_id_idx
  on public.service_processes (category_id);

alter table public.service_processes enable row level security;

revoke all on public.service_processes from public, anon, authenticated;
grant select, insert, update, delete on public.service_processes to authenticated;

drop policy if exists "employees read service steps" on public.service_processes;
drop policy if exists "admins add service steps" on public.service_processes;
drop policy if exists "admins edit service steps" on public.service_processes;
drop policy if exists "admins remove service steps" on public.service_processes;

create policy "employees read service steps"
  on public.service_processes for select to authenticated
  using ((select public.app_role()) is not null);

create policy "admins add service steps"
  on public.service_processes for insert to authenticated
  with check ((select public.app_role()) = 'admin');

create policy "admins edit service steps"
  on public.service_processes for update to authenticated
  using ((select public.app_role()) = 'admin')
  with check ((select public.app_role()) = 'admin');

create policy "admins remove service steps"
  on public.service_processes for delete to authenticated
  using ((select public.app_role()) = 'admin');

------------------------------------------------------------------------------
-- 2. Add-on quantity
------------------------------------------------------------------------------

alter table public.order_addons add column if not exists qty integer not null default 1;
alter table public.order_addons add column if not exists unit_price numeric;

update public.order_addons set unit_price = coalesce(price, 0) where unit_price is null;

alter table public.order_addons drop constraint if exists order_addons_qty_check;
alter table public.order_addons add constraint order_addons_qty_check check (qty between 1 and 99);

------------------------------------------------------------------------------
-- 3. Who earns what
------------------------------------------------------------------------------

create table if not exists public.order_credits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_service_id uuid references public.order_services(id) on delete cascade,
  order_addon_id uuid references public.order_addons(id) on delete cascade,
  kind text not null check (kind in ('service', 'addon', 'sale')),
  -- Deleting an employee keeps what they earned under their name (as 21
  -- does for the sale itself).
  worker_id uuid references public.workers(id) on delete set null,
  worker_name text not null,
  process text,
  share numeric not null default 1 check (share > 0 and share <= 1),
  sales_amount numeric not null default 0 check (sales_amount >= 0),
  commission numeric not null default 0 check (commission >= 0),
  rule_label text,
  added_by text,
  created_at timestamptz not null default now(),
  check (
    (kind = 'service' and order_service_id is not null and order_addon_id is null)
    or (kind = 'addon' and order_addon_id is not null and order_service_id is null)
    or (kind = 'sale' and order_service_id is null and order_addon_id is null)
  )
);

create index if not exists order_credits_order_id_idx on public.order_credits (order_id);
create index if not exists order_credits_worker_id_idx on public.order_credits (worker_id);
create index if not exists order_credits_order_service_id_idx on public.order_credits (order_service_id);
create index if not exists order_credits_order_addon_id_idx on public.order_credits (order_addon_id);

alter table public.order_credits enable row level security;

-- Written only by create_order and add_to_sale, and removed only with the
-- sale or line they belong to.
revoke all on public.order_credits from public, anon, authenticated;
grant select on public.order_credits to authenticated;

drop policy if exists "admins and secretaries read sale credits" on public.order_credits;

create policy "admins and secretaries read sale credits"
  on public.order_credits for select to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

-- Every sale so far had one worker, who earned every line. Only sales with
-- no credits yet, so re-running adds nothing.
do $$
begin
  if exists (select 1 from public.order_credits) then
    return;
  end if;

  insert into public.order_credits (
    order_id, order_service_id, kind, worker_id, worker_name, share,
    sales_amount, commission, rule_label, created_at
  )
  select s.order_id, s.id, 'service', o.worker_id,
         coalesce(nullif(btrim(o.worker_name), ''), 'Unknown'), 1,
         greatest(coalesce(s.price, 0), 0), greatest(coalesce(s.commission, 0), 0),
         o.commission_label, s.created_at
    from public.order_services s
    join public.orders o on o.id = s.order_id;

  insert into public.order_credits (
    order_id, order_addon_id, kind, worker_id, worker_name, share,
    sales_amount, commission, rule_label, created_at
  )
  select a.order_id, a.id, 'addon', o.worker_id,
         coalesce(nullif(btrim(o.worker_name), ''), 'Unknown'), 1,
         greatest(coalesce(a.price, 0), 0), greatest(coalesce(a.commission, 0), 0),
         null, a.created_at
    from public.order_addons a
    join public.orders o on o.id = a.order_id;

  -- What is left (a flat per-order amount, or everything on sales from
  -- before 13) belongs to the sale as a whole.
  insert into public.order_credits (
    order_id, kind, worker_id, worker_name, share, sales_amount, commission,
    rule_label, created_at
  )
  select o.id, 'sale', o.worker_id,
         coalesce(nullif(btrim(o.worker_name), ''), 'Unknown'), 1, 0,
         round(coalesce(o.commission, 0) - coalesce(c.lines, 0), 2),
         o.commission_label, o.created_at
    from public.orders o
    left join (
      select order_id, sum(commission) as lines
        from public.order_credits
       group by order_id
    ) c on c.order_id = o.id
   where coalesce(o.commission, 0) - coalesce(c.lines, 0) > 0.004;
end $$;

------------------------------------------------------------------------------
-- 4. The active workers, for choosing who helped
------------------------------------------------------------------------------

-- Names and commission rules only: the form works out each helper's
-- commission under their own rule. Empty for anyone who is not an employee.
create or replace function public.active_workers()
returns table (
  id uuid,
  name text,
  commission_mode text,
  commission_value numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.commission_mode, w.commission_value
    from public.workers w
   where w.status = 'Active'
     and w.role = 'Worker'
     and public.app_role() is not null
   order by w.name;
$$;

revoke all on function public.active_workers() from public, anon;
grant execute on function public.active_workers() to authenticated;

------------------------------------------------------------------------------
-- 5. Recording a sale's lines with their credits
------------------------------------------------------------------------------

-- The credits for one line, checked. Sent none, the line goes to the lead
-- worker in full, as every line did before. Each credited worker must be an
-- active worker, or the sale's own worker (who may have left since the sale,
-- and can still be credited on what is added to it, as in 24); their name is
-- taken from their record, not from the app.
create or replace function public.checked_credits(
  p_credits jsonb,
  p_lead_id uuid,
  p_lead_name text,
  p_amount numeric,
  p_commission numeric
)
returns table (
  worker_id uuid,
  worker_name text,
  process text,
  share numeric,
  sales_amount numeric,
  commission numeric,
  rule_label text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_credit jsonb;
  v_share numeric;
  v_total_share numeric := 0;
  v_name text;
begin
  if p_credits is null or jsonb_typeof(p_credits) <> 'array' or jsonb_array_length(p_credits) = 0 then
    return query select p_lead_id, coalesce(nullif(btrim(p_lead_name), ''), 'Unknown'),
                        null::text, 1::numeric, greatest(coalesce(p_amount, 0), 0),
                        greatest(coalesce(p_commission, 0), 0), null::text;
    return;
  end if;

  for v_credit in select value from jsonb_array_elements(p_credits) loop
    select w.name into v_name
      from public.workers w
     where w.id = nullif(v_credit ->> 'worker_id', '')::uuid
       and ((w.status = 'Active' and w.role = 'Worker') or w.id = p_lead_id);

    if v_name is null then
      raise exception 'Everyone credited on a sale must be an active worker.'
        using errcode = '42501';
    end if;

    v_share := coalesce((v_credit ->> 'share')::numeric, 0);

    if v_share <= 0 or v_share > 1
       or coalesce((v_credit ->> 'commission')::numeric, 0) < 0
       or coalesce((v_credit ->> 'sales_amount')::numeric, 0) < 0 then
      raise exception 'Each worker''s share must be above 0%% and at most 100%%, and no amount can be below zero.'
        using errcode = '22023';
    end if;

    v_total_share := v_total_share + v_share;

    worker_id := (v_credit ->> 'worker_id')::uuid;
    worker_name := v_name;
    process := nullif(btrim(v_credit ->> 'process'), '');
    share := round(v_share, 4);
    sales_amount := round(coalesce((v_credit ->> 'sales_amount')::numeric, v_share * coalesce(p_amount, 0)), 2);
    commission := round(coalesce((v_credit ->> 'commission')::numeric, 0), 2);
    rule_label := nullif(btrim(v_credit ->> 'rule_label'), '');
    return next;
  end loop;

  if abs(v_total_share - 1) > 0.001 then
    raise exception 'The workers'' shares of a line must add up to 100%%.'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.checked_credits(jsonb, uuid, text, numeric, numeric) from public, anon, authenticated;

-- Writes a sale's services, add-ons and per-sale credits, and returns what
-- they add up to. Used by create_order and add_to_sale, which decide who may
-- call them; nobody calls this directly.
create or replace function public.record_sale_lines(
  p_order_id uuid,
  p_lead_id uuid,
  p_lead_name text,
  p_services jsonb,
  p_addons jsonb,
  p_sale_credits jsonb,
  p_added_by text,
  out service_total numeric,
  out addon_total numeric,
  out commission numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_line_id uuid;
  v_price numeric;
  v_unit numeric;
  v_qty integer;
  v_commission numeric;
  v_credit jsonb;
  v_name text;
begin
  service_total := 0;
  addon_total := 0;
  commission := 0;

  for v_line in select value from jsonb_array_elements(coalesce(p_services, '[]'::jsonb)) loop
    -- create_order has always skipped a service with no category.
    continue when coalesce(btrim(v_line ->> 'category'), '') = '';

    v_price := coalesce((v_line ->> 'price')::numeric, 0);

    if v_price < 0 or coalesce((v_line ->> 'commission')::numeric, 0) < 0 then
      raise exception 'No price or commission can be below zero.' using errcode = '22023';
    end if;

    insert into public.order_services (
      order_id, category, size, price, commission_type, commission_rate,
      commission, added_by
    )
    values (
      p_order_id, v_line ->> 'category', coalesce(v_line ->> 'size', ''), v_price,
      v_line ->> 'commission_type', coalesce((v_line ->> 'commission_rate')::numeric, 0),
      (v_line ->> 'commission')::numeric, p_added_by
    )
    returning id into v_line_id;

    insert into public.order_credits (
      order_id, order_service_id, kind, worker_id, worker_name, process, share,
      sales_amount, commission, rule_label, added_by
    )
    select p_order_id, v_line_id, 'service', c.worker_id, c.worker_name, c.process,
           c.share, c.sales_amount, c.commission, c.rule_label, p_added_by
      from public.checked_credits(v_line -> 'credits', p_lead_id, p_lead_name,
                                  v_price, (v_line ->> 'commission')::numeric) c;

    -- The line's commission is what its workers earn.
    select coalesce(sum(c.commission), 0) into v_commission
      from public.order_credits c where c.order_service_id = v_line_id;

    update public.order_services s set commission = v_commission where s.id = v_line_id;

    service_total := service_total + v_price;
    commission := commission + v_commission;
  end loop;

  for v_line in select value from jsonb_array_elements(coalesce(p_addons, '[]'::jsonb)) loop
    continue when coalesce(btrim(v_line ->> 'name'), '') = '';

    -- The app live before this sends a price and no quantity.
    v_qty := coalesce((v_line ->> 'qty')::integer, 1);
    v_unit := coalesce((v_line ->> 'unit_price')::numeric, (v_line ->> 'price')::numeric, 0);
    v_price := round(v_unit * v_qty, 2);

    if v_qty < 1 or v_qty > 99 then
      raise exception 'An add-on can be had 1 to 99 times.' using errcode = '22023';
    end if;

    if v_unit < 0 or coalesce((v_line ->> 'commission')::numeric, 0) < 0 then
      raise exception 'No price or commission can be below zero.' using errcode = '22023';
    end if;

    insert into public.order_addons (
      order_id, name, qty, unit_price, price, commission_rate, commission,
      details, added_by
    )
    values (
      p_order_id, v_line ->> 'name', v_qty, v_unit, v_price,
      (v_line ->> 'commission_rate')::numeric, (v_line ->> 'commission')::numeric,
      nullif(btrim(v_line ->> 'details'), ''), p_added_by
    )
    returning id into v_line_id;

    insert into public.order_credits (
      order_id, order_addon_id, kind, worker_id, worker_name, process, share,
      sales_amount, commission, rule_label, added_by
    )
    select p_order_id, v_line_id, 'addon', c.worker_id, c.worker_name, c.process,
           c.share, c.sales_amount, c.commission, c.rule_label, p_added_by
      from public.checked_credits(v_line -> 'credits', p_lead_id, p_lead_name,
                                  v_price, (v_line ->> 'commission')::numeric) c;

    select coalesce(sum(c.commission), 0) into v_commission
      from public.order_credits c where c.order_addon_id = v_line_id;

    update public.order_addons a set commission = v_commission where a.id = v_line_id;

    addon_total := addon_total + v_price;
    commission := commission + v_commission;
  end loop;

  -- A flat per-order amount, once per worker per sale.
  for v_credit in select value from jsonb_array_elements(coalesce(p_sale_credits, '[]'::jsonb)) loop
    select w.name into v_name
      from public.workers w
     where w.id = nullif(v_credit ->> 'worker_id', '')::uuid
       and w.status = 'Active'
       and w.role = 'Worker';

    if v_name is null then
      raise exception 'Everyone credited on a sale must be an active worker.'
        using errcode = '42501';
    end if;

    v_commission := round(coalesce((v_credit ->> 'commission')::numeric, 0), 2);

    if v_commission < 0 then
      raise exception 'No commission can be below zero.' using errcode = '22023';
    end if;

    if exists (
      select 1 from public.order_credits c
       where c.order_id = p_order_id and c.kind = 'sale'
         and c.worker_id = (v_credit ->> 'worker_id')::uuid
    ) then
      raise exception '% already earned a flat amount on this sale.', v_name
        using errcode = '22023';
    end if;

    if v_commission > 0 then
      insert into public.order_credits (
        order_id, kind, worker_id, worker_name, share, sales_amount, commission,
        rule_label, added_by
      )
      values (
        p_order_id, 'sale', (v_credit ->> 'worker_id')::uuid, v_name, 1, 0,
        v_commission, nullif(btrim(v_credit ->> 'rule_label'), ''), p_added_by
      );

      commission := commission + v_commission;
    end if;
  end loop;
end;
$$;

revoke all on function public.record_sale_lines(uuid, uuid, text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;

------------------------------------------------------------------------------
-- 6. create_order records the credits
--
-- Identical to 19 up to and including the insert of the sale. The lines
-- then go in through record_sale_lines, and the sale's service total, add-on
-- total and commission are set from what was stored.
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
  v_lines record;
  v_rest numeric;
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
-- 7. add_to_sale records the credits
--
-- As in 24, with the lines going in through record_sale_lines, and a fourth
-- argument for flat per-order amounts earned by a worker new to the sale.
-- It defaults to none, so the app live today, which sends three, still
-- works.
------------------------------------------------------------------------------

drop function if exists public.add_to_sale(uuid, jsonb, jsonb);

create or replace function public.add_to_sale(
  p_order_id uuid,
  p_services jsonb,
  p_addons jsonb,
  p_sale_credits jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_name text := public.my_access() ->> 'name';
  v_services jsonb := coalesce(p_services, '[]'::jsonb);
  v_addons jsonb := coalesce(p_addons, '[]'::jsonb);
  v_order public.orders;
  v_lines record;
begin
  if v_role is null or v_role not in ('admin', 'secretary') then
    raise exception 'Only an admin or a secretary can add to a sale.'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_services) <> 'array' or jsonb_typeof(v_addons) <> 'array'
     or jsonb_typeof(coalesce(p_sale_credits, '[]'::jsonb)) <> 'array' then
    raise exception 'Services and add-ons must be sent as lists.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(v_services) + jsonb_array_length(v_addons) = 0 then
    raise exception 'Choose a service or an add-on to add.' using errcode = '22023';
  end if;

  if exists (
       select 1 from jsonb_array_elements(v_services) s
        where coalesce(btrim(s.value ->> 'category'), '') = ''
     ) or exists (
       select 1 from jsonb_array_elements(v_addons) a
        where coalesce(btrim(a.value ->> 'name'), '') = ''
     ) then
    raise exception 'Each service needs a category, each add-on a name, and no amount can be below zero.'
      using errcode = '22023';
  end if;

  -- Locked until these lines are in, so a second addition waits and then
  -- adds to the totals this one leaves.
  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'That sale no longer exists.' using errcode = '23503';
  end if;

  if v_order.archived_at is not null then
    raise exception 'That sale is archived. Put it back before adding to it.'
      using errcode = '22023';
  end if;

  select * into v_lines
    from public.record_sale_lines(
      p_order_id, v_order.worker_id, v_order.worker_name,
      v_services, v_addons, p_sale_credits, v_name
    );

  -- Raised by what was added, never recounted from the lines, so a sale's
  -- earlier figures stay exactly as they were. Total, Paid and Balance
  -- follow from these (recompute_order_paid, 24).
  update public.orders o
     set service_total = coalesce(o.service_total, 0) + v_lines.service_total,
         addon_total = coalesce(o.addon_total, 0) + v_lines.addon_total,
         commission = coalesce(o.commission, 0) + v_lines.commission
   where o.id = p_order_id;
end;
$$;

revoke all on function public.add_to_sale(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.add_to_sale(uuid, jsonb, jsonb, jsonb) to authenticated;

------------------------------------------------------------------------------
-- Check the work
------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.service_processes') is null or to_regclass('public.order_credits') is null then
    raise exception 'service_processes or order_credits was not created.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_addons' and column_name = 'qty') then
    raise exception 'order_addons.qty was not added.';
  end if;

  if to_regprocedure('public.add_to_sale(uuid, jsonb, jsonb)') is not null then
    raise exception 'The old three-argument add_to_sale is still there; calls would be ambiguous.';
  end if;

  if has_function_privilege('anon', 'public.add_to_sale(uuid, jsonb, jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.create_order(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.active_workers()', 'execute') then
    raise exception 'Visitors must not be able to record sales or list workers.';
  end if;

  if has_function_privilege('authenticated', 'public.record_sale_lines(uuid, uuid, text, jsonb, jsonb, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'public.checked_credits(jsonb, uuid, text, numeric, numeric)', 'execute') then
    raise exception 'record_sale_lines and checked_credits must only be reachable through create_order and add_to_sale.';
  end if;

  if not has_function_privilege('authenticated', 'public.add_to_sale(uuid, jsonb, jsonb, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.create_order(jsonb)', 'execute') then
    raise exception 'Signed-in staff must be able to call create_order and add_to_sale (they check roles themselves).';
  end if;

  if exists (select 1 from public.order_services s
              where not exists (select 1 from public.order_credits c where c.order_service_id = s.id))
     or exists (select 1 from public.order_addons a
                 where not exists (select 1 from public.order_credits c where c.order_addon_id = a.id)) then
    raise exception 'Some services or add-ons have nobody credited.';
  end if;

  if exists (select 1 from public.order_addons a where abs(a.price - a.unit_price * a.qty) > 0.005) then
    raise exception 'Some add-ons'' price is not unit price x quantity.';
  end if;

  -- Every sale's credits add up to its commission, so no report moves.
  if exists (
    select 1 from public.orders o
      left join (select order_id, sum(commission) as earned
                   from public.order_credits group by order_id) c on c.order_id = o.id
     where abs(coalesce(o.commission, 0) - coalesce(c.earned, 0)) > 0.005
  ) then
    raise exception 'Some sales'' credits do not add up to their commission. Stopping.';
  end if;
end $$;
