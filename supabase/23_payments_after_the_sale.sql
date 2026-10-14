-- Payments after the sale, and Labor alongside other add-ons
-- (client request, 2026-10-14)
--
-- A customer can pay a sale off in parts, on different days. Until now the
-- only way to record that was to overwrite the sale's payment amounts, which
-- kept no record of when each part came in or what it was paid with.
--
-- 1. public.order_payments holds every payment made after the sale: method,
--    amount, reference number, proof image, the time it was recorded and by
--    whom. The payment taken at the sale stays exactly where it is, on the
--    order, so the sales already recorded are not touched.
-- 2. A sale's Paid and Balance now always include its later payments. The
--    database works them out on every payment change, so the app cannot
--    leave them out of step. For every sale recorded so far the result is
--    the figure it already holds, and the check at the end of this file
--    fails if that is not so.
-- 3. A later payment cannot be more than what is still owed, and a sale that
--    is archived takes no new payments. Two people adding a payment to the
--    same sale at once cannot both slip under the balance: the sale is locked
--    while each one is checked.
-- 4. A payment is never deleted. Removing one marks it removed, with when and
--    by whom, and it stops counting. The history stays.
-- 5. Admins can upload proof images too. Until now only workers and
--    secretaries could, and admins record later payments as well.
-- 6. The worker-priced add-on is renamed from "Labor Only" to "Labor". It is
--    no longer only on its own: the Worker Form lets it sit with other
--    add-ons. Sales already recorded keep the name they were recorded with.
--
-- Nothing here updates, deletes or rewrites an existing sale. The only
-- existing row that changes is the add-on's name in the price list.
--
-- RUN THIS BEFORE DEPLOYING THE APP VERSION THAT SHOWS LATER PAYMENTS. That
-- version reads order_payments, and Sales Records would fail to load without
-- it. The version live today ignores everything here, so applying it first
-- changes nothing anyone sees, apart from the add-on's name. Run once. Safe
-- to re-run.

------------------------------------------------------------------------------
-- 1. Later payments
------------------------------------------------------------------------------

create table if not exists public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method text not null check (method in ('cash', 'gcash', 'credit', 'bank')),
  amount numeric not null check (amount > 0),
  reference text,
  proof_path text,
  proof_name text,
  note text,
  paid_at timestamptz not null default now(),
  recorded_by text,
  removed_at timestamptz,
  removed_by text
);

create index if not exists order_payments_order_id_idx
  on public.order_payments (order_id);

alter table public.order_payments enable row level security;

-- Read and add; the only change allowed afterwards is marking one removed.
-- No delete, for anyone using the app.
revoke all on public.order_payments from public, anon, authenticated;
grant select, insert on public.order_payments to authenticated;
grant update (removed_at) on public.order_payments to authenticated;

drop policy if exists "admins and secretaries read sale payments" on public.order_payments;
drop policy if exists "admins and secretaries add sale payments" on public.order_payments;
drop policy if exists "admins and secretaries remove sale payments" on public.order_payments;

create policy "admins and secretaries read sale payments"
  on public.order_payments for select to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins and secretaries add sale payments"
  on public.order_payments for insert to authenticated
  with check ((select public.app_role()) in ('admin', 'secretary'));

create policy "admins and secretaries remove sale payments"
  on public.order_payments for update to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'))
  with check ((select public.app_role()) in ('admin', 'secretary'));

------------------------------------------------------------------------------
-- 2. Paid and Balance include later payments
------------------------------------------------------------------------------

-- The same sum the app has always made from the methods ticked at the sale,
-- plus the later payments that have not been removed.
create or replace function public.recompute_order_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

  new.balance := coalesce(new.total, 0) - new.total_paid;

  return new;
end;
$$;

-- Only when a payment figure is written. Archiving, putting back and every
-- other change leave Paid and Balance alone.
drop trigger if exists recompute_order_paid on public.orders;
create trigger recompute_order_paid
  before update of cash, gcash, credit, bank, payment_enabled, total, total_paid, balance
  on public.orders
  for each row execute function public.recompute_order_paid();

------------------------------------------------------------------------------
-- 3 and 4. Checks on each later payment, and who did it
------------------------------------------------------------------------------

create or replace function public.check_order_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_name text := public.my_access() ->> 'name';
begin
  if tg_op = 'INSERT' then
    -- Locked until this payment is in, so a second one waits and then sees
    -- the balance this one leaves.
    select * into v_order from public.orders o where o.id = new.order_id for update;

    if not found then
      raise exception 'That sale no longer exists.' using errcode = '23503';
    end if;

    if v_order.archived_at is not null then
      raise exception 'That sale is archived. Put it back before adding a payment.'
        using errcode = '22023';
    end if;

    if new.amount > coalesce(v_order.balance, 0) + 0.005 then
      raise exception 'That is more than the % still owed on this sale.',
        to_char(greatest(coalesce(v_order.balance, 0), 0), 'FM999,999,990.00')
        using errcode = '22023';
    end if;

    new.paid_at := now();
    new.recorded_by := v_name;
    new.removed_at := null;
    new.removed_by := null;
  else
    if old.removed_at is not null then
      raise exception 'That payment was already removed.' using errcode = '22023';
    end if;

    if new.removed_at is null then
      raise exception 'A payment can only be removed, not changed.' using errcode = '22023';
    end if;

    new.removed_at := now();
    new.removed_by := v_name;
  end if;

  return new;
end;
$$;

drop trigger if exists check_order_payment on public.order_payments;
create trigger check_order_payment
  before insert or update on public.order_payments
  for each row execute function public.check_order_payment();

-- After a payment is added or removed, the sale's Paid and Balance follow.
-- Writing total_paid is what sets off recompute_order_paid above.
create or replace function public.sync_order_paid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.orders set total_paid = total_paid where id = new.order_id;
  return null;
end;
$$;

drop trigger if exists sync_order_paid on public.order_payments;
create trigger sync_order_paid
  after insert or update on public.order_payments
  for each row execute function public.sync_order_paid();

-- Trigger functions: nobody needs to call them directly, and they still fire.
revoke execute on function public.recompute_order_paid() from public, anon, authenticated;
revoke execute on function public.check_order_payment() from public, anon, authenticated;
revoke execute on function public.sync_order_paid() from public, anon, authenticated;

------------------------------------------------------------------------------
-- 5. Admins upload proof images too
------------------------------------------------------------------------------

drop policy if exists "workers and secretaries upload payment proofs" on storage.objects;
drop policy if exists "staff upload payment proofs" on storage.objects;

-- Named the way the app names them: <yyyy-mm-dd>/<uuid>.jpg|png
create policy "staff upload payment proofs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (select public.app_role()) in ('worker', 'secretary', 'admin')
    and name ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}[.](jpg|png)$'
  );

------------------------------------------------------------------------------
-- 6. "Labor Only" becomes "Labor"
------------------------------------------------------------------------------

update public.add_ons
   set name = 'Labor'
 where name = 'Labor Only'
   and worker_sets_price
   and not exists (select 1 from public.add_ons a where a.name = 'Labor');

------------------------------------------------------------------------------
-- Check the work
------------------------------------------------------------------------------

do $$
declare
  v_differs int;
begin
  if to_regclass('public.order_payments') is null then
    raise exception 'order_payments was not created.';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'order_payments' and cmd = 'DELETE'
  ) then
    raise exception 'A delete policy exists on order_payments. Payments must never be deleted.';
  end if;

  if (select count(*) from pg_trigger
       where tgname in ('recompute_order_paid', 'check_order_payment', 'sync_order_paid')
         and not tgisinternal) <> 3 then
    raise exception 'Expected 3 payment triggers.';
  end if;

  -- The new rule must give every sale already recorded exactly the Paid and
  -- Balance it holds now, or editing one later would move its numbers.
  select count(*) into v_differs
    from public.orders o
   where abs(o.total_paid - (
            case when coalesce((o.payment_enabled ->> 'cash')::boolean, false) then coalesce(o.cash, 0) else 0 end
          + case when coalesce((o.payment_enabled ->> 'gcash')::boolean, false) then coalesce(o.gcash, 0) else 0 end
          + case when coalesce((o.payment_enabled ->> 'credit')::boolean, false) then coalesce(o.credit, 0) else 0 end
          + case when coalesce((o.payment_enabled ->> 'bank')::boolean, false) then coalesce(o.bank, 0) else 0 end
          + coalesce((select sum(p.amount) from public.order_payments p
                       where p.order_id = o.id and p.removed_at is null), 0))) > 0.005
      or abs(o.balance - (coalesce(o.total, 0) - o.total_paid)) > 0.005;

  if v_differs <> 0 then
    raise exception '% sales would get a different Paid or Balance under the new rule. Nothing should change; stopping.', v_differs;
  end if;

  if (select count(*) from public.add_ons where worker_sets_price and name = 'Labor') <> 1 then
    raise exception 'Expected one worker-priced add-on named Labor.';
  end if;
end $$;
