-- Log a login out on every device (2026-10-05)
--
-- For the admin Logins page. Changing a password does not end the sessions
-- already open, so a phone that was logged in with the old password would
-- stay logged in. This ends them: their refresh tokens go with them, and
-- each device is logged out when its current access token runs out (within
-- the hour, Supabase's default).
--
-- Only the admin-logins Edge Function calls it, with Supabase's secret key,
-- after checking that the caller is an admin. Nobody using the app can call
-- it directly: it is granted to service_role only.
--
-- Run once, before using "Log out everywhere" or "Change password" on the
-- Logins page. The rest of the app does not need it. Safe to re-run.

create or replace function public.sign_out_everywhere(p_user_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  with ended as (
    delete from auth.sessions s
     where s.user_id = p_user_id
    returning 1
  )
  select count(*)::integer from ended;
$$;

revoke all on function public.sign_out_everywhere(uuid) from public, anon, authenticated;
grant execute on function public.sign_out_everywhere(uuid) to service_role;
