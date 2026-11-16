-- Vale and CM forms (client revision, 2026-11-13)
--
-- A worker who takes a cash advance (Vale) or a CM fills in a form with the
-- date, their name, the amount and their signature. An admin or secretary
-- approves or rejects it. Approved ones are taken off that week's payslip
-- (28). The paper form had exactly these fields.
--
-- 1. public.worker_requests: each form, with who filed it, its status, and
--    who reviewed it and when. Signed forms are never deleted from the app;
--    a mistaken one is rejected.
-- 2. Storage bucket "signatures" (private): the signature image, a small PNG
--    drawn on the screen. Any employee can add one; only admins and
--    secretaries can open them, through a short-lived signed link.
-- 3. public.file_request(...): files a form. A worker files for themself (on
--    the shared worker login, for whichever worker on it they choose), dated
--    today or up to 7 days back. A secretary or admin files for any active
--    worker, on any day up to today. The signature must already be stored.
-- 4. public.review_request(...): an admin or secretary approves or rejects
--    a form, or puts it back to pending, with an optional note.
-- 5. public.my_requests(): a worker on a login of their own sees their own
--    forms. The shared worker login sees none: everyone uses it.
--
-- RUN THIS BEFORE DEPLOYING THE APP VERSION WITH THE REQUESTS PAGE. The
-- version live today ignores everything here. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. The forms
------------------------------------------------------------------------------

create table if not exists public.worker_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('vale', 'cm')),
  -- Deleting an employee keeps their forms under their name (as 21 does
  -- for sales).
  worker_id uuid references public.workers(id) on delete set null,
  worker_name text not null,
  request_date date not null,
  amount numeric not null check (amount > 0),
  reason text,
  signature_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  filed_by text,
  filed_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text
);

create index if not exists worker_requests_worker_id_idx on public.worker_requests (worker_id);
create index if not exists worker_requests_request_date_idx on public.worker_requests (request_date);

alter table public.worker_requests enable row level security;

-- Read by admins and secretaries; written only through the functions below.
revoke all on public.worker_requests from public, anon, authenticated;
grant select on public.worker_requests to authenticated;

drop policy if exists "admins and secretaries read worker requests" on public.worker_requests;

create policy "admins and secretaries read worker requests"
  on public.worker_requests for select to authenticated
  using ((select public.app_role()) in ('admin', 'secretary'));

------------------------------------------------------------------------------
-- 2. Signatures
------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signatures', 'signatures', false, 204800, array['image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "employees upload signatures" on storage.objects;
drop policy if exists "admins and secretaries view signatures" on storage.objects;

-- Named the way the app names them: <yyyy-mm-dd>/<uuid>.png. No update or
-- delete rule, so a signature cannot be altered or erased from the app.
create policy "employees upload signatures"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and (select public.app_role()) in ('worker', 'secretary', 'admin')
    and name ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}[.]png$'
  );

create policy "admins and secretaries view signatures"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'signatures'
    and (select public.app_role()) in ('admin', 'secretary')
  );

------------------------------------------------------------------------------
-- 3. Filing a form
------------------------------------------------------------------------------

create or replace function public.file_request(
  p_kind text,
  p_worker_id uuid,
  p_request_date date,
  p_amount numeric,
  p_reason text,
  p_signature_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.app_role();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_worker_id uuid;
  v_worker_name text;
  v_on_login integer;
  v_row public.worker_requests;
begin
  if v_role is null then
    raise exception 'Only a signed-in employee can file a Vale or CM.' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('vale', 'cm') then
    raise exception 'Choose Vale or CM.' using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'The amount must be more than zero.' using errcode = '22023';
  end if;

  if p_request_date is null or p_request_date > v_today then
    raise exception 'The date cannot be in the future.' using errcode = '22023';
  end if;

  if p_signature_path is null
     or p_signature_path !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}[.]png$'
     or not exists (
       select 1 from storage.objects o
        where o.bucket_id = 'signatures' and o.name = p_signature_path
     ) then
    raise exception 'The form needs a signature.' using errcode = '22023';
  end if;

  if v_role in ('admin', 'secretary') then
    select w.id, w.name into v_worker_id, v_worker_name
      from public.workers w
     where w.id = p_worker_id and w.status = 'Active' and w.role = 'Worker';

    if v_worker_id is null then
      raise exception 'Choose an active worker.' using errcode = '22023';
    end if;
  else
    if p_request_date < v_today - 7 then
      raise exception 'A worker can file for today or the last 7 days. Ask the office for an older date.'
        using errcode = '22023';
    end if;

    select count(*) into v_on_login
      from public.workers w
     where w.status = 'Active' and w.role = 'Worker'
       and w.login_email is not null
       and lower(w.login_email) = lower(auth.jwt() ->> 'email');

    select w.id, w.name into v_worker_id, v_worker_name
      from public.workers w
     where w.status = 'Active' and w.role = 'Worker'
       and lower(w.login_email) = lower(auth.jwt() ->> 'email')
       and (w.id = p_worker_id or (p_worker_id is null and v_on_login = 1));

    if v_worker_id is null then
      raise exception 'Choose your name. A worker can only file for themself.' using errcode = '42501';
    end if;
  end if;

  insert into public.worker_requests (
    kind, worker_id, worker_name, request_date, amount, reason, signature_path, filed_by
  )
  values (
    p_kind, v_worker_id, v_worker_name, p_request_date, round(p_amount, 2),
    nullif(btrim(p_reason), ''), p_signature_path, public.my_access() ->> 'name'
  )
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'worker_name', v_row.worker_name, 'filed_at', v_row.filed_at);
end;
$$;

revoke all on function public.file_request(text, uuid, date, numeric, text, text) from public, anon;
grant execute on function public.file_request(text, uuid, date, numeric, text, text) to authenticated;

------------------------------------------------------------------------------
-- 4. Approving or rejecting
------------------------------------------------------------------------------

create or replace function public.review_request(
  p_id uuid,
  p_status text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.app_role() is null or public.app_role() not in ('admin', 'secretary') then
    raise exception 'Only an admin or a secretary can approve or reject a Vale or CM.'
      using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;

  update public.worker_requests r
     set status = p_status,
         review_note = nullif(btrim(p_note), ''),
         reviewed_by = case when p_status = 'pending' then null else public.my_access() ->> 'name' end,
         reviewed_at = case when p_status = 'pending' then null else now() end
   where r.id = p_id;

  if not found then
    raise exception 'That form no longer exists.' using errcode = '23503';
  end if;
end;
$$;

revoke all on function public.review_request(uuid, text, text) from public, anon;
grant execute on function public.review_request(uuid, text, text) to authenticated;

------------------------------------------------------------------------------
-- 5. A worker's own forms
------------------------------------------------------------------------------

-- Only on a login that is one worker's own: on the shared worker login
-- everyone would see everyone's. No signature paths.
create or replace function public.my_requests()
returns table (
  id uuid,
  kind text,
  request_date date,
  amount numeric,
  reason text,
  status text,
  filed_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.kind, r.request_date, r.amount, r.reason, r.status,
         r.filed_at, r.reviewed_by, r.reviewed_at, r.review_note
    from public.worker_requests r
   where public.app_role() = 'worker'
     and coalesce((public.my_access() ->> 'shared')::boolean, true) = false
     and r.worker_id = (public.my_access() ->> 'employee_id')::uuid
   order by r.request_date desc, r.filed_at desc;
$$;

revoke all on function public.my_requests() from public, anon;
grant execute on function public.my_requests() to authenticated;

------------------------------------------------------------------------------
-- Check the work
------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.worker_requests') is null then
    raise exception 'worker_requests was not created.';
  end if;

  if not exists (select 1 from storage.buckets where id = 'signatures' and not public) then
    raise exception 'The signatures bucket must exist and be private.';
  end if;

  if has_table_privilege('authenticated', 'public.worker_requests', 'insert')
     or has_table_privilege('authenticated', 'public.worker_requests', 'update')
     or has_table_privilege('authenticated', 'public.worker_requests', 'delete') then
    raise exception 'Forms must only be written through file_request and review_request.';
  end if;

  if has_function_privilege('anon', 'public.file_request(text, uuid, date, numeric, text, text)', 'execute')
     or has_function_privilege('anon', 'public.review_request(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.my_requests()', 'execute') then
    raise exception 'Visitors must not file, review or read forms.';
  end if;
end $$;
