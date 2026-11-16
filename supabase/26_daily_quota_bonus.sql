-- Daily quota bonus (client revision, 2026-11-13)
--
-- The shop has a daily car quota: 60 cars on weekdays and 80 on Saturdays
-- and Sundays. On a day the shop reaches it, every worker who worked on at
-- least one car that day earns a bonus, ₱150 by default. The bonus is part of
-- the weekly payslip (28).
--
-- 1. public.quota_settings: the quota and the bonus, for weekdays and for
--    weekends, each from an effective date. The rule in force on a day is the
--    one with the latest effective date on or before it, so a change applies
--    from its date on and past weeks never move. The first rule, from
--    2000-01-01, is the shop's 60 / 80 cars and ₱150.
-- 2. Admins add rules on the Quota page. A rule can be changed or removed
--    only while its date is today or later: one already in force for past
--    days stays as it was, and a new rule from today replaces it.
-- 3. Employees can read the rules (the payslip and the dashboard use them).
--
-- Nothing here changes a sale. RUN THIS BEFORE DEPLOYING THE APP VERSION WITH
-- THE QUOTA PAGE: that version reads quota_settings. The version live today
-- ignores it. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. The rules
------------------------------------------------------------------------------

create table if not exists public.quota_settings (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  weekday_quota integer not null check (weekday_quota > 0),
  weekend_quota integer not null check (weekend_quota > 0),
  weekday_bonus numeric not null default 0 check (weekday_bonus >= 0),
  weekend_bonus numeric not null default 0 check (weekend_bonus >= 0),
  created_by text,
  created_at timestamptz not null default now()
);

insert into public.quota_settings (
  effective_from, weekday_quota, weekend_quota, weekday_bonus, weekend_bonus, created_by
)
values ('2000-01-01', 60, 80, 150, 150, 'Default')
on conflict (effective_from) do nothing;

-- Who added or last changed a rule, from the login, not from the app.
create or replace function public.stamp_quota_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := coalesce(public.my_access() ->> 'name', new.created_by);
  return new;
end;
$$;

revoke execute on function public.stamp_quota_setting() from public, anon, authenticated;

drop trigger if exists stamp_quota_setting on public.quota_settings;
create trigger stamp_quota_setting
  before insert or update on public.quota_settings
  for each row execute function public.stamp_quota_setting();

------------------------------------------------------------------------------
-- 2. Who may do what
------------------------------------------------------------------------------

alter table public.quota_settings enable row level security;

revoke all on public.quota_settings from public, anon, authenticated;
grant select, insert, update, delete on public.quota_settings to authenticated;

drop policy if exists "employees read quota rules" on public.quota_settings;
drop policy if exists "admins add quota rules" on public.quota_settings;
drop policy if exists "admins change quota rules not yet in force" on public.quota_settings;
drop policy if exists "admins remove quota rules not yet in force" on public.quota_settings;

create policy "employees read quota rules"
  on public.quota_settings for select to authenticated
  using ((select public.app_role()) is not null);

-- Today or later only: a rule for past days would change past payslips.
create policy "admins add quota rules"
  on public.quota_settings for insert to authenticated
  with check (
    (select public.app_role()) = 'admin'
    and effective_from >= (now() at time zone 'Asia/Manila')::date
  );

create policy "admins change quota rules not yet in force"
  on public.quota_settings for update to authenticated
  using (
    (select public.app_role()) = 'admin'
    and effective_from >= (now() at time zone 'Asia/Manila')::date
  )
  with check (
    (select public.app_role()) = 'admin'
    and effective_from >= (now() at time zone 'Asia/Manila')::date
  );

create policy "admins remove quota rules not yet in force"
  on public.quota_settings for delete to authenticated
  using (
    (select public.app_role()) = 'admin'
    and effective_from >= (now() at time zone 'Asia/Manila')::date
  );

------------------------------------------------------------------------------
-- Check the work
------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from public.quota_settings where effective_from <= current_date) then
    raise exception 'There is no quota rule in force.';
  end if;

  if has_table_privilege('anon', 'public.quota_settings', 'select') then
    raise exception 'Visitors must not read the quota rules.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'quota_settings') <> 4 then
    raise exception 'Expected four rules on quota_settings.';
  end if;
end $$;
