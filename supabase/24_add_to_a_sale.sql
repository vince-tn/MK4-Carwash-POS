-- Adding services and add-ons to a sale after it was recorded
-- (client request, 2026-10-27)
--
-- A car sometimes gets more done after its sale is recorded: another
-- service, or an add-on. Until now the only way was a second sale. Admins
-- and secretaries can now add them to the sale itself, from its Edit window
-- in Sales Records.
--
-- 1. order_services.added_by and order_addons.added_by: who added a line
--    after the sale. Lines recorded with the sale keep null. created_at
--    already says when each line was added.
-- 2. public.add_to_sale(order, services, add-ons) adds them in one step:
--    the lines go in, and the sale's service total, add-on total and
--    commission go up by exactly what was added. Nothing it earned or was
--    paid before changes. Two people adding to the same sale at once cannot
--    lose each other's lines: the sale is locked while each one is added. An
--    archived sale takes nothing; put it back first.
-- 3. The database now works out a sale's Total too, whenever a figure it
--    depends on is written, with the rule the app has always used: services
--    plus add-ons, less a ticked discount, never below zero. Paid and
--    Balance follow, as since 23. Until now Total came from the app, which
--    was safe while services could not change after the sale; now, a payment
--    saved from a screen opened before someone added a service would have
--    written the old Total back. The database has the last word instead.
--    For every sale recorded so far the rule gives the Total it already
--    holds, and the check at the end of this file fails if that is not so.
--
-- The app works out each new line's commission, exactly as the Worker Form
-- does for a new sale (create_order stores what the form sends the same
-- way); a flat per-order amount is never added twice.
--
-- Nothing here changes a sale already recorded: applying it changes no row.
-- RUN THIS BEFORE DEPLOYING THE APP VERSION THAT ADDS TO SALES: that version
-- reads added_by, and Sales Records would fail to load without it. The
-- version live today ignores everything here. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Who added a line
------------------------------------------------------------------------------

alter table public.order_services add column if not exists added_by text;
alter table public.order_addons add column if not exists added_by text;

------------------------------------------------------------------------------
-- 2. Adding to a sale
------------------------------------------------------------------------------

create or replace function public.add_to_sale(
  p_order_id uuid,
  p_services jsonb,
  p_addons jsonb
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
  v_service_count integer;
  v_service_total numeric;
  v_service_commission numeric;
  v_addon_count integer;
  v_addon_total numeric;
  v_addon_commission numeric;
begin
  if v_role is null or v_role not in ('admin', 'secretary') then
    raise exception 'Only an admin or a secretary can add to a sale.'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_services) <> 'array' or jsonb_typeof(v_addons) <> 'array' then
    raise exception 'Services and add-ons must be sent as lists.'
      using errcode = '22023';
  end if;

  select count(*), coalesce(sum(coalesce(s.price, 0)), 0), coalesce(sum(coalesce(s.commission, 0)), 0)
    into v_service_count, v_service_total, v_service_commission
    from jsonb_populate_recordset(null::public.order_services, v_services) s;

  select count(*), coalesce(sum(coalesce(a.price, 0)), 0), coalesce(sum(coalesce(a.commission, 0)), 0)
    into v_addon_count, v_addon_total, v_addon_commission
    from jsonb_populate_recordset(null::public.order_addons, v_addons) a;

  if v_service_count + v_addon_count = 0 then
    raise exception 'Choose a service or an add-on to add.' using errcode = '22023';
  end if;

  if exists (
       select 1 from jsonb_populate_recordset(null::public.order_services, v_services) s
        where coalesce(btrim(s.category), '') = ''
           or coalesce(s.price, 0) < 0 or coalesce(s.commission, 0) < 0
     ) or exists (
       select 1 from jsonb_populate_recordset(null::public.order_addons, v_addons) a
        where coalesce(btrim(a.name), '') = ''
           or coalesce(a.price, 0) < 0 or coalesce(a.commission, 0) < 0
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

  insert into public.order_services (
    order_id, category, size, price, commission_type, commission_rate,
    commission, added_by
  )
  select
    p_order_id, s.category, coalesce(s.size, ''), coalesce(s.price, 0),
    s.commission_type, coalesce(s.commission_rate, 0),
    coalesce(s.commission, 0), v_name
  from jsonb_populate_recordset(null::public.order_services, v_services) s;

  insert into public.order_addons (
    order_id, name, price, commission_rate, commission, details, added_by
  )
  select
    p_order_id, a.name, coalesce(a.price, 0), a.commission_rate,
    coalesce(a.commission, 0), a.details, v_name
  from jsonb_populate_recordset(null::public.order_addons, v_addons) a;

  -- Raised by what was added, never recounted from the lines, so a sale's
  -- earlier figures stay exactly as they were. Total, Paid and Balance
  -- follow from these (recompute_order_paid, below).
  update public.orders o
     set service_total = coalesce(o.service_total, 0) + v_service_total,
         addon_total = coalesce(o.addon_total, 0) + v_addon_total,
         commission = coalesce(o.commission, 0) + v_service_commission + v_addon_commission
   where o.id = p_order_id;
end;
$$;

revoke all on function public.add_to_sale(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.add_to_sale(uuid, jsonb, jsonb) to authenticated;

------------------------------------------------------------------------------
-- 3. Total, Paid and Balance, all worked out by the database
------------------------------------------------------------------------------

-- 23's function, with Total worked out first. Paid and Balance are exactly
-- as in 23.
create or replace function public.recompute_order_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.total := greatest(
      coalesce(new.service_total, 0) + coalesce(new.addon_total, 0)
    - case when coalesce((new.payment_enabled ->> 'discount')::boolean, false)
           then coalesce(new.discount, 0) else 0 end,
    0);

  new.total_paid :=
      case when coalesce((new.payment_enabled ->> 'cash')::boolean, false) then coalesce(new.cash, 0) else 0 end
    + case when coalesce((new.payment_enabled ->> 'gcash')::boolean, false) then coalesce(new.gcash, 0) else 0 end
    + case when coalesce((new.payment_enabled ->> 'credit')::boolean, false) then coalesce(new.credit, 0) else 0 end
    + case when coalesce((new.payment_enabled ->> 'bank')::boolean, false) then coalesce(new.bank, 0) else 0 end
    + coalesce((
        select sum(p.amount)
          from public.order_payments p
         where p.order_id = new.id
           and p.removed_at is null
      ), 0);

  new.balance := new.total - new.total_paid;

  return new;
end;
$$;

-- Now also when the services, add-ons or discount are written. Archiving,
-- putting back and every other change still leave the figures alone.
drop trigger if exists recompute_order_paid on public.orders;
create trigger recompute_order_paid
  before update of cash, gcash, credit, bank, discount, payment_enabled,
                   service_total, addon_total, total, total_paid, balance
  on public.orders
  for each row execute function public.recompute_order_paid();

revoke execute on function public.recompute_order_paid() from public, anon, authenticated;

------------------------------------------------------------------------------
-- Check the work
------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_services' and column_name = 'added_by')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'order_addons' and column_name = 'added_by') then
    raise exception 'added_by was not added to the sale lines.';
  end if;

  if to_regprocedure('public.add_to_sale(uuid, jsonb, jsonb)') is null then
    raise exception 'add_to_sale was not created.';
  end if;

  if has_function_privilege('anon', 'public.add_to_sale(uuid, jsonb, jsonb)', 'execute') then
    raise exception 'Visitors must not be able to call add_to_sale.';
  end if;

  if not has_function_privilege('authenticated', 'public.add_to_sale(uuid, jsonb, jsonb)', 'execute') then
    raise exception 'Signed-in staff must be able to call add_to_sale (it checks their role itself).';
  end if;

  if (select count(*) from pg_trigger
       where tgname = 'recompute_order_paid' and tgrelid = 'public.orders'::regclass
         and not tgisinternal) <> 1 then
    raise exception 'Expected the recompute_order_paid trigger on orders.';
  end if;

  -- The rule must give every sale already recorded exactly the Total, Paid
  -- and Balance it holds now, or editing one later would move its numbers.
  if exists (
    select 1 from public.orders o
     where abs(o.total - greatest(
                coalesce(o.service_total, 0) + coalesce(o.addon_total, 0)
              - case when coalesce((o.payment_enabled ->> 'discount')::boolean, false)
                     then coalesce(o.discount, 0) else 0 end, 0)) > 0.005
        or abs(o.total_paid - (
              case when coalesce((o.payment_enabled ->> 'cash')::boolean, false) then coalesce(o.cash, 0) else 0 end
            + case when coalesce((o.payment_enabled ->> 'gcash')::boolean, false) then coalesce(o.gcash, 0) else 0 end
            + case when coalesce((o.payment_enabled ->> 'credit')::boolean, false) then coalesce(o.credit, 0) else 0 end
            + case when coalesce((o.payment_enabled ->> 'bank')::boolean, false) then coalesce(o.bank, 0) else 0 end
            + coalesce((select sum(p.amount) from public.order_payments p
                         where p.order_id = o.id and p.removed_at is null), 0))) > 0.005
        or abs(o.balance - (o.total - o.total_paid)) > 0.005
  ) then
    raise exception 'Some sales would get a different Total, Paid or Balance under the rule. Nothing should change; stopping.';
  end if;
end $$;
