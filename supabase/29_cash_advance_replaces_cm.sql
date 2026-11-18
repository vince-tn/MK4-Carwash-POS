-- Cash Advance replaces CM (client, 2026-11-18)
--
-- The client's two forms are the Vale form and the Cash Advance form, kept
-- apart but laid out the same. What 27 called "CM" is the Cash Advance.
--
-- 1. worker_requests.kind is now 'vale' or 'cash_advance'. Every form filed
--    as CM becomes a Cash Advance; nothing else about it changes (amount,
--    date, status, signature, who filed and reviewed it).
-- 2. file_request takes 'vale' or 'cash_advance'. Otherwise exactly as 27.
--
-- Payslips take approved Vale and Cash Advance off the week as before; the
-- amounts do not change.
--
-- RUN THIS BEFORE DEPLOYING THE APP VERSION WITH SEPARATE VALE AND CASH
-- ADVANCE FORMS: that version files 'cash_advance', which 27 refuses. The
-- version on staging until then files 'cm', which this refuses, so deploy it
-- right after. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. CM becomes Cash Advance
------------------------------------------------------------------------------

alter table public.worker_requests drop constraint if exists worker_requests_kind_check;

update public.worker_requests set kind = 'cash_advance' where kind = 'cm';

alter table public.worker_requests
  add constraint worker_requests_kind_check check (kind in ('vale', 'cash_advance'));

------------------------------------------------------------------------------
-- 2. Filing takes Vale or Cash Advance
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
    raise exception 'Only a signed-in employee can file a Vale or Cash Advance.' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('vale', 'cash_advance') then
    raise exception 'Choose Vale or Cash Advance.' using errcode = '22023';
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
-- Check the work
------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.worker_requests where kind not in ('vale', 'cash_advance')) then
    raise exception 'Some forms are neither Vale nor Cash Advance.';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.worker_requests'::regclass
       and conname = 'worker_requests_kind_check'
       and pg_get_constraintdef(oid) like '%cash_advance%'
  ) then
    raise exception 'The form type rule was not updated.';
  end if;

  if position('cash_advance' in pg_get_functiondef('public.file_request(text, uuid, date, numeric, text, text)'::regprocedure)) = 0 then
    raise exception 'file_request does not take Cash Advance.';
  end if;

  if has_function_privilege('anon', 'public.file_request(text, uuid, date, numeric, text, text)', 'execute') then
    raise exception 'Visitors must not file forms.';
  end if;
end $$;
