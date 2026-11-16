-- STAGING ONLY. A rollback-only test of supabase/25_several_workers_per_sale.sql:
-- run it with Apply Migration (project: staging) after 25. It acts as the
-- admin, secretary and shared worker logins, prints what happened (counts and
-- yes/no only: the log is public), and then undoes everything. Every line
-- ends in "ok" or "WRONG"; the last line counts the WRONGs.

do $$
begin
  if to_regclass('mk4_staging.marker') is null then
    raise exception 'Staging only. Nothing was run.';
  end if;
end $$;

do $t$
declare
  v_admin text := (select login_email from public.workers
                    where role = 'Admin' and status = 'Active' and login_email is not null
                    order by created_at limit 1);
  v_secretary text := (select email from public.role_logins where role = 'Secretary');
  v_worker text := (select email from public.role_logins where role = 'Worker');
  wa uuid;
  wb uuid;
  wc uuid;
  v_off uuid;
  r jsonb;
  o public.orders;
  n int;
  x numeric;
  msg text;
  wrong int := 0;

  -- One line of the report.
  procedure_ok boolean;
begin
  -- Two active workers on the shared worker login, a third anywhere (a
  -- helper may be on a login of their own), and one who is not active.
  select id into wa from public.workers
   where status = 'Active' and role = 'Worker' and lower(login_email) = lower(v_worker) order by name limit 1;
  select id into wb from public.workers
   where status = 'Active' and role = 'Worker' and lower(login_email) = lower(v_worker) and id <> wa order by name limit 1;
  select id into wc from public.workers
   where status = 'Active' and role = 'Worker' and id not in (wa, wb)
   order by (lower(login_email) = lower(v_worker)), name limit 1;

  if wa is null or wb is null then
    raise exception 'Needs at least two active workers on the shared worker login to test with.';
  end if;

  insert into public.workers (name, role, status, commission_mode, commission_value, notes)
  values ('Test Inactive Worker', 'Worker', 'Inactive', 'inherit', 0, 'test')
  returning id into v_off;

  -- 0. Every sale already recorded has credits that add up.
  select count(*) into n from public.orders o2
    left join (select order_id, sum(commission) s from public.order_credits group by order_id) c on c.order_id = o2.id
   where abs(coalesce(o2.commission, 0) - coalesce(c.s, 0)) > 0.005;
  procedure_ok := n = 0; wrong := wrong + (not procedure_ok)::int;
  raise notice 'SALES WHOSE CREDITS DO NOT ADD UP: % -- %', n, case when procedure_ok then 'ok' else 'WRONG' end;

  -- 1. The shared worker login records a car done by two workers, with
  --    2x an add-on done by the second, and a flat amount for the first.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_worker)::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.active_workers();
  procedure_ok := n >= 2; wrong := wrong + (not procedure_ok)::int;
  raise notice 'WORKER LOGIN SEES ACTIVE WORKERS: % -- %', n >= 2, case when procedure_ok then 'ok' else 'WRONG' end;

  r := public.create_order(jsonb_build_object(
    'worker_id', wa, 'plate_number', 'TEST 25', 'commission', 999,
    'service_total', 1, 'addon_total', 1, 'total', 1,
    'sale_credits', jsonb_build_array(jsonb_build_object('worker_id', wa, 'commission', 50, 'rule_label', 'Flat per order')),
    'services', jsonb_build_array(jsonb_build_object(
      'category', 'Test Package', 'size', 'Medium', 'price', 1000, 'commission_rate', 30, 'commission', 300,
      'credits', jsonb_build_array(
        jsonb_build_object('worker_id', wa, 'process', 'Interior', 'share', 0.6, 'sales_amount', 600, 'commission', 180),
        jsonb_build_object('worker_id', wb, 'process', 'Exterior', 'share', 0.4, 'sales_amount', 400, 'commission', 120)))),
    'addons', jsonb_build_array(jsonb_build_object(
      'name', 'Test Add-on', 'unit_price', 150, 'qty', 2, 'commission_rate', 10, 'commission', 30,
      'credits', jsonb_build_array(jsonb_build_object('worker_id', wb, 'share', 1, 'sales_amount', 300, 'commission', 30))))
  ));
  execute 'reset role';

  select * into o from public.orders where id = (r ->> 'id')::uuid;
  procedure_ok := o.service_total = 1000 and o.addon_total = 300 and o.total = 1300 and o.commission = 380;
  wrong := wrong + (not procedure_ok)::int;
  raise notice 'NEW SALE: services %, add-ons %, total %, commission % (want 1000, 300, 1300, 380: the app''s own totals are replaced) -- %',
    o.service_total, o.addon_total, o.total, o.commission, case when procedure_ok then 'ok' else 'WRONG' end;

  select count(*) into n from public.order_credits where order_id = o.id;
  procedure_ok := n = 4; wrong := wrong + (not procedure_ok)::int;
  raise notice 'CREDITS ON IT: % (want 4: two steps, the add-on, the flat amount) -- %', n, case when procedure_ok then 'ok' else 'WRONG' end;

  select coalesce(sum(commission), 0) into x from public.order_credits where order_id = o.id and worker_id = wb;
  procedure_ok := x = 150; wrong := wrong + (not procedure_ok)::int;
  raise notice 'SECOND WORKER EARNS: % (want 150) -- %', x, case when procedure_ok then 'ok' else 'WRONG' end;

  select count(*) into n from public.order_addons where order_id = o.id and qty = 2 and unit_price = 150 and price = 300 and commission = 30;
  procedure_ok := n = 1; wrong := wrong + (not procedure_ok)::int;
  raise notice 'ADD-ON TWICE: stored as 2 x 150 = 300 % -- %', n = 1, case when procedure_ok then 'ok' else 'WRONG' end;

  -- 2. The same call without credits, as the app live before 25 sends it:
  --    everything goes to the one worker, as it always did.
  execute 'set local role authenticated';
  r := public.create_order(jsonb_build_object(
    'worker_id', wa, 'plate_number', 'TEST 25 OLD', 'commission', 125, 'commission_label', 'Flat per order',
    'services', '[{"category":"Test Wash","size":"Small","price":250,"commission":75}]'::jsonb,
    'addons', '[]'::jsonb));
  execute 'reset role';
  select * into o from public.orders where id = (r ->> 'id')::uuid;
  select count(*) into n from public.order_credits where order_id = o.id and worker_id = wa;
  procedure_ok := o.commission = 125 and n = 2; wrong := wrong + (not procedure_ok)::int;
  raise notice 'SALE FROM TODAY''S APP: commission % (want 125), credits % (want 2, both the one worker''s) -- %',
    o.commission, n, case when procedure_ok then 'ok' else 'WRONG' end;

  -- 3. Refusals when recording.
  execute 'set local role authenticated';
  begin
    perform public.create_order(jsonb_build_object('worker_id', wa, 'plate_number', 'TEST X', 'sale_credits', '[]'::jsonb,
      'services', jsonb_build_array(jsonb_build_object('category', 'X', 'price', 100, 'credits', jsonb_build_array(
        jsonb_build_object('worker_id', wa, 'share', 0.5), jsonb_build_object('worker_id', wb, 'share', 0.3))))));
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  procedure_ok := msg = 'refused'; wrong := wrong + (not procedure_ok)::int;
  raise notice 'SHARES ADDING TO 80%%: % (want refused) -- %', msg, case when procedure_ok then 'ok' else 'WRONG' end;

  begin
    perform public.create_order(jsonb_build_object('worker_id', wa, 'plate_number', 'TEST X', 'sale_credits', '[]'::jsonb,
      'services', jsonb_build_array(jsonb_build_object('category', 'X', 'price', 100, 'credits', jsonb_build_array(
        jsonb_build_object('worker_id', v_off, 'share', 1))))));
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  procedure_ok := msg = 'refused'; wrong := wrong + (not procedure_ok)::int;
  raise notice 'CREDITING AN INACTIVE WORKER: % (want refused) -- %', msg, case when procedure_ok then 'ok' else 'WRONG' end;

  begin
    perform public.create_order(jsonb_build_object('worker_id', wa, 'plate_number', 'TEST X', 'sale_credits', '[]'::jsonb,
      'addons', '[{"name":"X","unit_price":10,"qty":0}]'::jsonb));
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  procedure_ok := msg = 'refused'; wrong := wrong + (not procedure_ok)::int;
  raise notice 'ADD-ON ZERO TIMES: % (want refused) -- %', msg, case when procedure_ok then 'ok' else 'WRONG' end;

  select count(*) into n from public.order_credits;
  procedure_ok := n = 0; wrong := wrong + (not procedure_ok)::int;
  raise notice 'WORKER LOGIN READS CREDITS: % rows (want 0) -- %', n, case when procedure_ok then 'ok' else 'WRONG' end;

  begin
    perform public.record_sale_lines(o.id, wa, 'x', '[]'::jsonb, '[{"name":"X","price":1}]'::jsonb, '[]'::jsonb, null);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  procedure_ok := msg = 'refused'; wrong := wrong + (not procedure_ok)::int;
  raise notice 'CALLING record_sale_lines DIRECTLY: % (want refused) -- %', msg, case when procedure_ok then 'ok' else 'WRONG' end;
  execute 'reset role';

  execute 'set local role anon';
  begin
    perform public.active_workers();
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  execute 'reset role';
  procedure_ok := msg = 'refused'; wrong := wrong + (not procedure_ok)::int;
  raise notice 'VISITOR LISTS WORKERS: % (want refused) -- %', msg, case when procedure_ok then 'ok' else 'WRONG' end;

  -- 4. The secretary adds a step done by a third worker to the first sale.
  select * into o from public.orders where plate_number = 'TEST 25';
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_secretary)::text, true);
  execute 'set local role authenticated';
  perform public.add_to_sale(o.id,
    jsonb_build_array(jsonb_build_object('category', 'Test Engine', 'size', 'Medium', 'price', 500, 'commission', 100,
      'credits', jsonb_build_array(jsonb_build_object('worker_id', coalesce(wc, wb), 'share', 1, 'sales_amount', 500, 'commission', 100)))),
    '[]'::jsonb, '[]'::jsonb);
  select count(*) into n from public.order_credits where order_id = o.id;

  begin
    perform public.add_to_sale(o.id, '[]'::jsonb, '[{"name":"X","price":1}]'::jsonb,
      jsonb_build_array(jsonb_build_object('worker_id', wa, 'commission', 50)));
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  execute 'reset role';

  procedure_ok := n = 5; wrong := wrong + (not procedure_ok)::int;
  raise notice 'SECRETARY ADDS A STEP: credits now % (want 5), secretary reads them -- %', n, case when procedure_ok then 'ok' else 'WRONG' end;

  procedure_ok := msg = 'refused'; wrong := wrong + (not procedure_ok)::int;
  raise notice 'A SECOND FLAT AMOUNT FOR THE SAME WORKER: % (want refused) -- %', msg, case when procedure_ok then 'ok' else 'WRONG' end;

  select * into o from public.orders where id = o.id;
  procedure_ok := o.service_total = 1500 and o.total = 1800 and o.commission = 480;
  wrong := wrong + (not procedure_ok)::int;
  raise notice 'AFTER ADDING: services %, total %, commission % (want 1500, 1800, 480) -- %',
    o.service_total, o.total, o.commission, case when procedure_ok then 'ok' else 'WRONG' end;

  -- 5. Today's app still adds with three arguments.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_admin)::text, true);
  execute 'set local role authenticated';
  perform public.add_to_sale(o.id, '[]'::jsonb, '[{"name":"Test Add-on 2","price":100,"commission_rate":10,"commission":10}]'::jsonb);
  execute 'reset role';
  select * into o from public.orders where id = o.id;
  procedure_ok := o.commission = 490 and o.addon_total = 400; wrong := wrong + (not procedure_ok)::int;
  raise notice 'ADMIN ADDS THE OLD WAY: commission % (want 490), add-ons % (want 400) -- %',
    o.commission, o.addon_total, case when procedure_ok then 'ok' else 'WRONG' end;

  -- 6. The sale's own worker has left: what is added can still be theirs,
  --    but not another inactive worker's.
  update public.workers set status = 'Inactive' where id = wa;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_admin)::text, true);
  execute 'set local role authenticated';
  begin
    perform public.add_to_sale(o.id, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('name', 'Test Add-on 3', 'unit_price', 50, 'qty', 1, 'commission', 5,
        'credits', jsonb_build_array(jsonb_build_object('worker_id', wa, 'share', 1, 'commission', 5)))));
    msg := 'allowed';
  exception when others then msg := 'REFUSED';
  end;
  execute 'reset role';
  update public.workers set status = 'Active' where id = wa;
  procedure_ok := msg = 'allowed'; wrong := wrong + (not procedure_ok)::int;
  raise notice 'ADDING FOR THE SALE''S OWN WORKER WHO HAS LEFT: % (want allowed) -- %', msg, case when procedure_ok then 'ok' else 'WRONG' end;

  -- 7. Still true of every sale.
  select count(*) into n from public.orders o2
    left join (select order_id, sum(commission) s from public.order_credits group by order_id) c on c.order_id = o2.id
   where abs(coalesce(o2.commission, 0) - coalesce(c.s, 0)) > 0.005;
  procedure_ok := n = 0; wrong := wrong + (not procedure_ok)::int;
  raise notice 'SALES WHOSE CREDITS DO NOT ADD UP: % -- %', n, case when procedure_ok then 'ok' else 'WRONG' end;

  raise notice 'WRONG: % (want 0)', wrong;
end;
$t$;

-- Undo everything above. (psql's closing COMMIT then finds nothing to do.)
rollback;
