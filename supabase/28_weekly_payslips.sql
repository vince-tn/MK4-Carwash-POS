-- Weekly payslips (client revision, 2026-11-13)
--
-- An estimate of each worker's pay for a pay week, Monday to Sunday, paid the
-- following Monday:
--   commission on the cars they worked on (order_credits, 25)
-- + the quota bonus for each day the shop reached its quota and they worked
--   on at least one car (26)
-- - approved Vale and CM dated in the week (27).
-- It is not a payroll system: nothing is stored, it is worked out each time
-- from the sales, rules and forms (src/lib/payroll.js).
--
-- Admins and secretaries already read everything a payslip needs. A worker
-- on a login of their own may see their own payslip and no one else's, and
-- cannot read sales, so:
--
-- 1. public.my_pay_week(day): for the pay week holding that day, the
--    worker's cars and commission per day, the shop's cars per day (whether
--    the quota was reached is the only thing that depends on it), the quota
--    rules, and their own forms in the week. Archived sales count for
--    nothing. The shared worker login gets nothing: everyone uses it.
--
-- RUN THIS BEFORE DEPLOYING THE APP VERSION WITH PAYSLIPS, and after 25, 26
-- and 27, whose tables it reads. Run once. Safe to re-run.

create or replace function public.my_pay_week(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access jsonb := public.my_access();
  v_worker_id uuid;
  v_start date;
  v_end date;
begin
  if public.app_role() is distinct from 'worker'
     or coalesce((v_access ->> 'shared')::boolean, true)
     or v_access ->> 'employee_id' is null then
    raise exception 'Only a worker on a login of their own can see their payslip.'
      using errcode = '42501';
  end if;

  v_worker_id := (v_access ->> 'employee_id')::uuid;
  v_start := coalesce(p_day, (now() at time zone 'Asia/Manila')::date);
  v_start := v_start - (extract(isodow from v_start)::integer - 1);
  v_end := v_start + 6;

  return jsonb_build_object(
    'worker', jsonb_build_object('id', v_worker_id, 'name', v_access ->> 'name'),
    'start', v_start,
    'end', v_end,
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', d.day,
               'shop_cars', coalesce(s.cars, 0),
               'cars', coalesce(m.cars, 0),
               'commission', coalesce(m.commission, 0)
             ) order by d.day), '[]'::jsonb)
        from generate_series(v_start, v_end, interval '1 day') as d(day)
        left join (
          select o.order_date as day, count(*) as cars
            from public.orders o
           where o.archived_at is null and o.order_date between v_start and v_end
           group by o.order_date
        ) s on s.day = d.day::date
        left join (
          select o.order_date as day, count(distinct o.id) as cars, sum(c.commission) as commission
            from public.order_credits c
            join public.orders o on o.id = c.order_id
           where o.archived_at is null and o.order_date between v_start and v_end
             and c.worker_id = v_worker_id
           group by o.order_date
        ) m on m.day = d.day::date
    ),
    'quota_settings', (
      select coalesce(jsonb_agg(to_jsonb(q) - 'created_by' - 'created_at' order by q.effective_from), '[]'::jsonb)
        from public.quota_settings q
    ),
    'requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'kind', r.kind, 'request_date', r.request_date,
               'amount', r.amount, 'reason', r.reason, 'status', r.status
             ) order by r.request_date, r.filed_at), '[]'::jsonb)
        from public.worker_requests r
       where r.worker_id = v_worker_id
         and r.request_date between v_start and v_end
    )
  );
end;
$$;

revoke all on function public.my_pay_week(date) from public, anon;
grant execute on function public.my_pay_week(date) to authenticated;

------------------------------------------------------------------------------
-- Check the work
------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.order_credits') is null
     or to_regclass('public.quota_settings') is null
     or to_regclass('public.worker_requests') is null then
    raise exception 'Run 25, 26 and 27 first.';
  end if;

  if has_function_privilege('anon', 'public.my_pay_week(date)', 'execute') then
    raise exception 'Visitors must not read payslips.';
  end if;
end $$;
