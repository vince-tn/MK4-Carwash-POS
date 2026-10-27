-- Staging refresh, step 1 of 2 (.github/workflows/staging-refresh.yml).
--
-- Stops unless this is the staging database. Only staging has the
-- mk4_staging.marker row (scripts/build-staging-sql.mjs puts it there); live
-- never does, so a mistaken address cannot empty the shop's data.
do $$
begin
  -- Two checks, not one: a query naming a table that does not exist fails
  -- with a less helpful message than this.
  if to_regclass('mk4_staging.marker') is null then
    raise exception 'This is not the staging database (no mk4_staging.marker table). Nothing was changed.';
  end if;

  if not exists (select 1 from mk4_staging.marker) then
    raise exception 'This is not the staging database (no mk4_staging.marker row). Nothing was changed.';
  end if;
end $$;

-- The copy goes in exactly as it is on live: no rules or totals recomputed
-- on the way in.
set session_replication_role = replica;
