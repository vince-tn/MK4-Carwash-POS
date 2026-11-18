-- STAGING ONLY. A rollback-only test of supabase/30_no_worker_dropdown.sql:
-- run it with Apply Migration (project: staging) after 30. It records sales
-- as the secretary, the shared worker login and a personal worker login,
-- prints what happened (counts and yes/no only: the log is public), and then
-- undoes everything. Every line ends in "ok" or "WRONG"; the last line counts
-- the WRONGs.

do $$
begin
  if to_regclass('mk4_staging.marker') is null then
    raise exception 'Staging only. Nothing was run.';
  end if;
end $$;

do $t$
declare
  v_secretary text := (select email from public.role_logins where role = 'Secretary');
  v_worker text := (select email from public.role_logins where role = 'Worker');
  v_personal text := 'test-personal-30@mk4.test';
  wa uuid;
  wb uuid;
  wp uuid;
  r jsonb;
  who uuid;
  msg text;
  ok boolean;
  wrong int := 0;

begin
  select id into wa from public.workers
   where status = 'Active' and role = 'Worker' and lower(login_email) = lower(v_worker) order by name limit 1;
  select id into wb from public.workers
   where status = 'Active' and role = 'Worker' and lower(login_email) = lower(v_worker) and id <> wa order by name limit 1;

  if wa is null or wb is null or v_secretary is null then
    raise exception 'Needs the secretary login and two workers on the shared login to test with.';
  end if;

  insert into public.workers (name, role, status, login_email, commission_mode, commission_value, notes)
  values ('Test Personal Worker 30', 'Worker', 'Active', v_personal, 'inherit', 0, 'test')
  returning id into wp;

  -- 1. The secretary sends no worker: the sale is the first credited one's.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_secretary)::text, true);
  execute 'set local role authenticated';
  r := public.create_order(jsonb_build_object(
    'plate_number', 'TEST 30A', 'sale_credits', '[]'::jsonb,
    'services', jsonb_build_array(jsonb_build_object('category', 'Test Wash', 'price', 200, 'commission', 60,
      'credits', jsonb_build_array(jsonb_build_object('worker_id', wb, 'share', 1, 'commission', 60)))),
    'addons', jsonb_build_array(jsonb_build_object('name', 'Test Add-on', 'unit_price', 100, 'qty', 1, 'commission', 10,
      'credits', jsonb_build_array(jsonb_build_object('worker_id', wa, 'share', 1, 'commission', 10))))));

  begin
    perform public.create_order(jsonb_build_object('plate_number', 'TEST 30X', 'sale_credits', '[]'::jsonb,
      'services', '[{"category":"Test Wash","price":200}]'::jsonb));
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  execute 'reset role';

  select worker_id into who from public.orders where id = (r ->> 'id')::uuid;
  ok := who = wb; wrong := wrong + (not ok)::int;
  raise notice 'SECRETARY, NO WORKER SENT: the sale is the first service''s worker % -- %', ok, case when ok then 'ok' else 'WRONG' end;

  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'SECRETARY, NOBODY CREDITED: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  -- 2. The shared login: the first credited worker who is on it.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_worker)::text, true);
  execute 'set local role authenticated';
  r := public.create_order(jsonb_build_object(
    'plate_number', 'TEST 30B', 'sale_credits', '[]'::jsonb,
    'services', jsonb_build_array(jsonb_build_object('category', 'Test Wash', 'price', 200, 'commission', 60,
      'credits', jsonb_build_array(
        jsonb_build_object('worker_id', wp, 'share', 0.5, 'commission', 30),
        jsonb_build_object('worker_id', wa, 'share', 0.5, 'commission', 30))))));

  begin
    perform public.create_order(jsonb_build_object('plate_number', 'TEST 30Y', 'sale_credits', '[]'::jsonb,
      'services', jsonb_build_array(jsonb_build_object('category', 'Test Wash', 'price', 200, 'commission', 60,
        'credits', jsonb_build_array(jsonb_build_object('worker_id', wp, 'share', 1, 'commission', 60))))));
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;

  -- The app before 30 still sends a worker.
  perform public.create_order(jsonb_build_object('worker_id', wb, 'plate_number', 'TEST 30OLD',
    'services', '[{"category":"Test Wash","price":200,"commission":60}]'::jsonb));
  execute 'reset role';

  select worker_id into who from public.orders where id = (r ->> 'id')::uuid;
  ok := who = wa; wrong := wrong + (not ok)::int;
  raise notice 'SHARED LOGIN: the sale is the first credited worker on the login, not the helper with their own login % -- %', ok, case when ok then 'ok' else 'WRONG' end;

  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'SHARED LOGIN, ONLY SOMEONE ELSE''S LOGIN CREDITED: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  select worker_id into who from public.orders where plate_number = 'TEST 30OLD';
  ok := who = wb; wrong := wrong + (not ok)::int;
  raise notice 'TODAY''S APP, WHICH SENDS A WORKER: still recorded under them % -- %', ok, case when ok then 'ok' else 'WRONG' end;

  -- 3. A personal login records their own car.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_personal)::text, true);
  execute 'set local role authenticated';
  r := public.create_order(jsonb_build_object(
    'plate_number', 'TEST 30C', 'sale_credits', '[]'::jsonb,
    'services', jsonb_build_array(jsonb_build_object('category', 'Test Wash', 'price', 200, 'commission', 60,
      'credits', jsonb_build_array(jsonb_build_object('worker_id', wp, 'share', 1, 'commission', 60))))));
  execute 'reset role';

  select worker_id into who from public.orders where id = (r ->> 'id')::uuid;
  ok := who = wp; wrong := wrong + (not ok)::int;
  raise notice 'PERSONAL LOGIN: recorded under themself % -- %', ok, case when ok then 'ok' else 'WRONG' end;

  raise notice 'WRONG: % (want 0)', wrong;
end;
$t$;

-- Undo everything above. (psql's closing COMMIT then finds nothing to do.)
rollback;
