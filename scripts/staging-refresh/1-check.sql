-- Staging refresh, step 1 of 2 (.github/workflows/staging-refresh.yml).
--
-- Stops unless this is the staging database. Only staging has the
-- mk4_staging.marker row (scripts/build-staging-sql.mjs puts it there); live
-- never does, so a mistaken address cannot empty the shop's data.
do $$
begin
  if to_regclass('mk4_staging.marker') is null
     or not exists (select 1 from mk4_staging.marker) then
    raise exception 'This is not the staging database (no mk4_staging.marker row). Nothing was changed.';
  end if;
end $$;

-- The copy goes in exactly as it is on live: no rules or totals recomputed
-- on the way in.
set session_replication_role = replica;
