-- STAGING ONLY. A rollback-only test of supabase/26_daily_quota_bonus.sql,
-- 27_vale_and_cm.sql and 28_weekly_payslips.sql: run it with Apply Migration
-- (project: staging) after 28. It acts as the admin, secretary, shared worker
-- and a personal worker login, prints what happened (counts and yes/no only:
-- the log is public), and then undoes everything. Every line ends in "ok" or
-- "WRONG"; the last line counts the WRONGs.

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
  v_personal text := 'test-personal-28@mk4.test';
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_sig text := to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') || '/' || gen_random_uuid() || '.png';
  wa uuid;
  wp uuid;
  r jsonb;
  req uuid;
  n int;
  x numeric;
  msg text;
  ok boolean;
  wrong int := 0;

begin
  select id into wa from public.workers
   where status = 'Active' and role = 'Worker' and lower(login_email) = lower(v_worker) order by name limit 1;

  if wa is null or v_admin is null or v_secretary is null then
    raise exception 'Needs an admin, the secretary login and a worker on the shared login to test with.';
  end if;

  -- A worker with a login of their own.
  insert into public.workers (name, role, status, login_email, commission_mode, commission_value, notes)
  values ('Test Personal Worker', 'Worker', 'Active', v_personal, 'inherit', 0, 'test')
  returning id into wp;

  -- A stored signature, as the app uploads it.
  insert into storage.objects (bucket_id, name) values ('signatures', v_sig);

  ------------------------------------------------------------------ 26 quota
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_admin)::text, true);
  execute 'set local role authenticated';

  begin
    insert into public.quota_settings (effective_from, weekday_quota, weekend_quota, weekday_bonus, weekend_bonus)
    values (v_today - 1, 10, 10, 1, 1);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'ADMIN ADDS A QUOTA RULE FOR YESTERDAY: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  insert into public.quota_settings (effective_from, weekday_quota, weekend_quota, weekday_bonus, weekend_bonus)
  values (v_today + 1, 61, 81, 160, 170);
  select count(*) into n from public.quota_settings where effective_from = v_today + 1 and created_by is not null;
  ok := n = 1; wrong := wrong + (not ok)::int;
  raise notice 'ADMIN ADDS A RULE FROM TOMORROW, STAMPED WITH WHO: % (want true) -- %', n = 1, case when ok then 'ok' else 'WRONG' end;

  update public.quota_settings set weekday_quota = 1 where effective_from < v_today;
  get diagnostics n = row_count;
  ok := n = 0; wrong := wrong + (not ok)::int;
  raise notice 'ADMIN CHANGES A RULE ALREADY IN FORCE: % rows (want 0) -- %', n, case when ok then 'ok' else 'WRONG' end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_secretary)::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.quota_settings (effective_from, weekday_quota, weekend_quota) values (v_today + 2, 5, 5);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  execute 'reset role';
  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'SECRETARY ADDS A QUOTA RULE: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_worker)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.quota_settings;
  execute 'reset role';
  ok := n >= 2; wrong := wrong + (not ok)::int;
  raise notice 'WORKER READS THE QUOTA RULES: % (want true) -- %', n >= 2, case when ok then 'ok' else 'WRONG' end;

  ------------------------------------------------------------ 27 Vale / CM
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_worker)::text, true);
  execute 'set local role authenticated';

  r := public.file_request('vale', wa, v_today, 500, 'test', v_sig);
  execute 'reset role';
  select count(*) into n from public.worker_requests
   where id = (r ->> 'id')::uuid and status = 'pending' and worker_id = wa and filed_by is not null;
  execute 'set local role authenticated';
  ok := n = 1; wrong := wrong + (not ok)::int;
  raise notice 'SHARED LOGIN FILES A VALE FOR ONE OF ITS WORKERS: pending % (want true) -- %', n = 1, case when ok then 'ok' else 'WRONG' end;

  begin
    perform public.file_request('vale', wp, v_today, 500, null, v_sig);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'SHARED LOGIN FILES FOR A WORKER NOT ON IT: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  begin
    perform public.file_request('vale', wa, v_today - 10, 500, null, v_sig);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'WORKER FILES 10 DAYS BACK: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  begin
    perform public.file_request('cm', wa, v_today + 1, 500, null, v_sig);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'FILING FOR TOMORROW: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  begin
    perform public.file_request('cm', wa, v_today, 500, null, v_today || '/' || gen_random_uuid() || '.png');
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'FILING WITHOUT A STORED SIGNATURE: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  begin
    perform public.file_request('cm', wa, v_today, 0, null, v_sig);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'FILING ZERO PESOS: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  select count(*) into n from public.worker_requests;
  ok := n = 0; wrong := wrong + (not ok)::int;
  raise notice 'WORKER READS FORMS DIRECTLY: % rows (want 0) -- %', n, case when ok then 'ok' else 'WRONG' end;

  select count(*) into n from public.my_requests();
  ok := n = 0; wrong := wrong + (not ok)::int;
  raise notice 'SHARED LOGIN''S OWN FORMS: % rows (want 0: everyone uses it) -- %', n, case when ok then 'ok' else 'WRONG' end;

  begin
    perform public.review_request((r ->> 'id')::uuid, 'approved', null);
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'WORKER APPROVES A FORM: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  begin
    insert into storage.objects (bucket_id, name) values ('signatures', 'anything.png');
    msg := 'ALLOWED';
  exception when others then msg := 'refused';
  end;
  ok := msg = 'refused'; wrong := wrong + (not ok)::int;
  raise notice 'UPLOADING A SIGNATURE NAMED ANY OLD WAY: % (want refused) -- %', msg, case when ok then 'ok' else 'WRONG' end;

  select count(*) into n from storage.objects where bucket_id = 'signatures';
  ok := n = 0; wrong := wrong + (not ok)::int;
  raise notice 'WORKER OPENS SIGNATURES: % (want 0) -- %', n, case when ok then 'ok' else 'WRONG' end;
  execute 'reset role';

  -- The personal worker files a CM for themself.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_personal)::text, true);
  execute 'set local role authenticated';
  perform public.file_request('cm', null, v_today, 200, null, v_sig);
  execute 'reset role';

  -- The secretary files an older Vale for them and approves both of theirs.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_secretary)::text, true);
  execute 'set local role authenticated';
  r := public.file_request('vale', wp, v_today - 30, 300, null, v_sig);
  for req in select id from public.worker_requests where worker_id = wp loop
    perform public.review_request(req, 'approved', 'test');
  end loop;
  select count(*) into n from public.worker_requests where worker_id = wp and status = 'approved' and reviewed_by is not null;
  execute 'reset role';
  ok := n = 2; wrong := wrong + (not ok)::int;
  raise notice 'SECRETARY FILES AN OLD VALE AND APPROVES: % approved (want 2) -- %', n, case when ok then 'ok' else 'WRONG' end;

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_personal)::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.my_requests();
  execute 'reset role';
  ok := n = 2; wrong := wrong + (not ok)::int;
  raise notice 'PERSONAL WORKER SEES THEIR OWN FORMS: % (want 2) -- %', n, case when ok then 'ok' else 'WRONG' end;

  ------------------------------------------------------------- 28 payslips
  -- A sale today for the personal worker, recorded by the secretary.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_secretary)::text, true);
  execute 'set local role authenticated';
  perform public.create_order(jsonb_build_object(
    'worker_id', wp, 'plate_number', 'TEST 28', 'sale_credits', '[]'::jsonb,
    'services', '[{"category":"Test Wash","size":"Small","price":250,"commission":75}]'::jsonb));
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', v_personal)::text, true);
  execute 'set local role authenticated';
  r := public.my_pay_week(v_today);
  execute 'reset role';

  select (d ->> 'cars')::int, (d ->> 'commission')::numeric into n, x
    from jsonb_array_elements(r -> 'days') d where (d ->> 'date')::date = v_today;
  ok := jsonb_array_length(r -> 'days') = 7 and n = 1 and x = 75
        and extract(isodow from (r ->> 'start')::date) = 1;
  wrong := wrong + (not ok)::int;
  raise notice 'PERSONAL WORKER''S PAY WEEK: 7 days from a Monday, today % car(s) and % commission (want 1 and 75) -- %',
    n, x, case when ok then 'ok' else 'WRONG' end;

  ok := jsonb_array_length(r -> 'requests') = 1 and jsonb_array_length(r -> 'quota_settings') >= 2;
  wrong := wrong + (not ok)::int;
  raise notice 'IT HOLDS THIS WEEK''S FORMS ONLY, AND THE QUOTA RULES: % -- %', ok, case when ok then 'ok' else 'WRONG' end;

  foreach msg in array array[v_worker, v_secretary, v_admin] loop
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'email', msg)::text, true);
    execute 'set local role authenticated';
    begin
      perform public.my_pay_week(v_today);
      ok := false;
    exception when others then ok := true;
    end;
    execute 'reset role';
    wrong := wrong + (not ok)::int;
    raise notice 'MY_PAY_WEEK FOR A LOGIN THAT IS NOT ONE WORKER''S OWN: refused % -- %', ok, case when ok then 'ok' else 'WRONG' end;
  end loop;

  execute 'set local role anon';
  begin
    perform public.my_pay_week(v_today);
    ok := false;
  exception when others then ok := true;
  end;
  execute 'reset role';
  wrong := wrong + (not ok)::int;
  raise notice 'VISITOR READS A PAYSLIP: refused % -- %', ok, case when ok then 'ok' else 'WRONG' end;

  raise notice 'WRONG: % (want 0)', wrong;
end;
$t$;

-- Undo everything above. (psql's closing COMMIT then finds nothing to do.)
rollback;
