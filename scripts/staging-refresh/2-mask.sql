-- Staging refresh, step 2 of 2 (.github/workflows/staging-refresh.yml).
--
-- Replaces the customers' details in the copy that was just loaded, so
-- staging never holds them: names, phone numbers, plates, payment references
-- and notes. Proof images are not copied, so their links are cleared.
-- Employees keep their names (the shop's staff, needed to test commissions)
-- but not their phone numbers or addresses. Money, services, dates and who
-- did what are kept exactly, so every total on staging matches live.

-- The dump ends by resetting the session; the payment rules must not fire
-- on these updates either.
set session_replication_role = replica;

-- A stand-in is worked out from the real value and a secret that lives only
-- for this run: the same plate gets the same stand-in all through the copy,
-- so a returning car still looks like one, but it cannot be worked back.
create temporary table refresh_salt on commit drop as
select gen_random_uuid()::text as salt;

update public.orders o
   set plate_number = 'TEST ' || upper(substr(md5(s.salt || o.plate_number), 1, 6)),
       customer_name = case when nullif(btrim(o.customer_name), '') is null then o.customer_name
                            else 'Customer ' || upper(substr(md5(s.salt || o.customer_name), 1, 5)) end,
       contact_number = case when nullif(btrim(o.contact_number), '') is null then o.contact_number
                             else '09' || substr(regexp_replace(md5(s.salt || o.contact_number), '[^0-9]', '', 'g') || '000000000', 1, 9) end,
       reference_no = case when nullif(btrim(o.reference_no), '') is null then o.reference_no
                           else 'REF-' || upper(substr(md5(s.salt || o.reference_no), 1, 8)) end,
       gcash_ref = case when nullif(btrim(o.gcash_ref), '') is null then o.gcash_ref
                        else 'REF-' || upper(substr(md5(s.salt || o.gcash_ref), 1, 8)) end,
       credit_ref = case when nullif(btrim(o.credit_ref), '') is null then o.credit_ref
                         else 'REF-' || upper(substr(md5(s.salt || o.credit_ref), 1, 8)) end,
       bank_ref = case when nullif(btrim(o.bank_ref), '') is null then o.bank_ref
                       else 'REF-' || upper(substr(md5(s.salt || o.bank_ref), 1, 8)) end,
       payment_notes = case when nullif(btrim(o.payment_notes), '') is null then o.payment_notes
                            else '(hidden on staging)' end,
       notes = case when nullif(btrim(o.notes), '') is null then o.notes
                    else '(hidden on staging)' end,
       photo_url = null,
       photo_path = null,
       photo_name = null
  from refresh_salt s;

update public.order_payments p
   set reference = case when nullif(btrim(p.reference), '') is null then p.reference
                        else 'REF-' || upper(substr(md5(s.salt || p.reference), 1, 8)) end,
       note = case when nullif(btrim(p.note), '') is null then p.note
                   else '(hidden on staging)' end,
       proof_path = null,
       proof_name = null
  from refresh_salt s;

update public.workers
   set phone = null,
       address = null,
       notes = null,
       profile_image_url = null;

-- Check the work before it is kept: one detail left behind and the whole
-- refresh is undone.
do $$
begin
  if exists (select 1 from public.orders where plate_number not like 'TEST %') then
    raise exception 'A plate number was left in the copy. Nothing was changed.';
  end if;

  if exists (select 1 from public.orders
              where photo_path is not null or photo_url is not null
                 or (customer_name is not null and btrim(customer_name) <> '' and customer_name not like 'Customer %')
                 or (contact_number is not null and btrim(contact_number) <> '' and contact_number !~ '^09[0-9]{9}$'))
     or exists (select 1 from public.order_payments where proof_path is not null)
     or exists (select 1 from public.workers
                 where phone is not null or address is not null or notes is not null) then
    raise exception 'A customer or employee detail was left in the copy. Nothing was changed.';
  end if;

  -- The copy must add up exactly as live does.
  if exists (
    select 1 from public.orders o
     where abs(o.total_paid - (
              case when coalesce((o.payment_enabled ->> 'cash')::boolean, false) then coalesce(o.cash, 0) else 0 end
            + case when coalesce((o.payment_enabled ->> 'gcash')::boolean, false) then coalesce(o.gcash, 0) else 0 end
            + case when coalesce((o.payment_enabled ->> 'credit')::boolean, false) then coalesce(o.credit, 0) else 0 end
            + case when coalesce((o.payment_enabled ->> 'bank')::boolean, false) then coalesce(o.bank, 0) else 0 end
            + coalesce((select sum(p.amount) from public.order_payments p
                         where p.order_id = o.id and p.removed_at is null), 0))) > 0.005
        or abs(o.balance - (coalesce(o.total, 0) - o.total_paid)) > 0.005
  ) then
    raise exception 'Some sales do not add up after the copy. Nothing was changed.';
  end if;
end $$;

reset session_replication_role;

select (select count(*) from public.orders) as sales,
       (select count(*) from public.orders where archived_at is null) as active_sales,
       (select count(*) from public.order_payments) as later_payments,
       (select count(*) from public.workers) as employees,
       (select count(*) from public.service_items) as price_list_sizes;
