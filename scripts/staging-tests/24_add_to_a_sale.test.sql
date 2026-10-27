-- STAGING ONLY. A rollback-only test of supabase/24_add_to_a_sale.sql:
-- run it with Apply Migration (project: staging) after 24. It acts as the
-- admin, secretary and worker logins, prints what happened (counts and
-- yes/no only: the log is public), and then undoes everything.

do $$
begin
  if to_regclass('mk4_staging.marker') is null then
    raise exception 'Staging only. Nothing was run.';
  end if;
end $$;

do $t$
declare
  o public.orders;
  a public.orders;
  arch uuid;
  n int;
  msg text;
begin
  -- An active sale with something still owed, and an archived one.
  select * into o from public.orders
   where archived_at is null and balance > 0 and not coalesce((payment_enabled ->> 'discount')::boolean, false)
   order by created_at desc limit 1;
  select id into arch from public.orders where archived_at is not null limit 1;

  if o.id is null then
    raise exception 'No active sale with a balance to test on.';
  end if;

  -- 1. The admin adds a 500 service (commission 150) and a 1,000 add-on
  --    (commission 120).
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'mk4autocare@gmail.com')::text, true);
  execute 'set local role authenticated';
  perform public.add_to_sale(
    o.id,
    '[{"category":"Test Service","size":"Medium","price":500,"commission_type":"Service percentage","commission_rate":30,"commission":150}]'::jsonb,
    '[{"name":"Test Add-on","price":1000,"commission_rate":12,"commission":120,"details":"test"}]'::jsonb
  );
  execute 'reset role';

  select * into a from public.orders where id = o.id;
  raise notice 'ADMIN ADDS: service total +% (want 500), add-on total +% (want 1000), total +% (want 1500), commission +% (want 270), paid unchanged %, balance +% (want 1500)',
    a.service_total - o.service_total, a.addon_total - o.addon_total, a.total - o.total,
    a.commission - o.commission, a.total_paid = o.total_paid, a.balance - o.balance;

  select count(*) into n from public.order_services s where s.order_id = o.id and s.added_by is not null;
  raise notice 'LINES: services marked added later % (want 1), add-ons marked added later % (want 1)',
    n, (select count(*) from public.order_addons x where x.order_id = o.id and x.added_by is not null);

  -- 2. A payment saved from a screen opened before the addition sends the
  --    old total. The database keeps the right one.
  update public.orders set total = o.total, cash = cash where id = o.id;
  select * into a from public.orders where id = o.id;
  raise notice 'STALE PAYMENT SAVE: total stays right % (want true)', a.total = o.total + 1500;

  -- 3. The secretary can add too.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'secretary@mk4.pos')::text, true);
  execute 'set local role authenticated';
  perform public.add_to_sale(o.id, '[]'::jsonb, '[{"name":"Test Add-on 2","price":100,"commission_rate":0,"commission":0}]'::jsonb);
  execute 'reset role';
  select * into a from public.orders where id = o.id;
  raise notice 'SECRETARY ADDS: total +% (want 1600)', a.total - o.total;

  -- 4. Refusals.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'worker@mk4.pos')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.add_to_sale(o.id, '[]'::jsonb, '[{"name":"X","price":1}]'::jsonb);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  execute 'reset role';
  raise notice 'WORKER: % (want refused)', msg;

  execute 'set local role anon';
  begin
    perform public.add_to_sale(o.id, '[]'::jsonb, '[{"name":"X","price":1}]'::jsonb);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  execute 'reset role';
  raise notice 'VISITOR: % (want refused)', msg;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'mk4autocare@gmail.com')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.add_to_sale(o.id, '[]'::jsonb, '[]'::jsonb);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  raise notice 'NOTHING CHOSEN: % (want refused)', msg;

  begin
    perform public.add_to_sale(o.id, '[{"category":"X","size":"S","price":-5}]'::jsonb, '[]'::jsonb);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  raise notice 'NEGATIVE PRICE: % (want refused)', msg;

  if arch is not null then
    begin
      perform public.add_to_sale(arch, '[]'::jsonb, '[{"name":"X","price":1}]'::jsonb);
      msg := 'ALLOWED';
    exception when others then msg := 'refused';
    end;
    raise notice 'ARCHIVED SALE: % (want refused)', msg;
  end if;
  execute 'reset role';

  -- 5. A later payment still settles the sale.
  select * into a from public.orders where id = o.id;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', 'mk4autocare@gmail.com')::text, true);
  execute 'set local role authenticated';
  insert into public.order_payments (order_id, method, amount) values (o.id, 'cash', a.balance);
  execute 'reset role';
  select * into a from public.orders where id = o.id;
  raise notice 'LATER PAYMENT OF THE BALANCE: balance now % (want 0)', a.balance;

  -- 6. Every sale still keeps the rule.
  select count(*) into n from public.orders x
   where abs(x.total - greatest(coalesce(x.service_total, 0) + coalesce(x.addon_total, 0)
           - case when coalesce((x.payment_enabled ->> 'discount')::boolean, false) then coalesce(x.discount, 0) else 0 end, 0)) > 0.005
      or abs(x.balance - (x.total - x.total_paid)) > 0.005;
  raise notice 'SALES BREAKING THE RULE: % (want 0)', n;
end;
$t$;

-- Undo everything above. (psql's closing COMMIT then finds nothing to do.)
rollback;
