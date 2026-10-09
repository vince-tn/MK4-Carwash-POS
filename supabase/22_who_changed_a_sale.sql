-- Record who changed a sale (client request, 2026-10-09)
--
-- 20 already records who archived a sale, but nothing recorded who put one
-- back or who edited a payment. payment_updated_at said when, never by whom.
--
-- Three nullable columns. That is the whole migration:
--   restored_at, restored_by    set when a sale is put back, so a sale that
--                               was taken out and returned says so.
--   payment_updated_by          the name beside the existing
--                               payment_updated_at.
--
-- NOTHING IS WRITTEN TO ANY EXISTING ROW. No default, no backfill, no update.
-- Every sale recorded before today keeps every value it has and simply has
-- null in the three new columns, which the app reads as "not known" and shows
-- as a dash. Totals, payments and reports are untouched by design: none of
-- these columns is read by any figure.
--
-- Archiving clears restored_at/restored_by and restoring clears
-- archived_at/archived_by, so a sale always shows its current state rather
-- than a confusing mix of both.
--
-- Run this BEFORE deploying the app version that writes them. The version
-- live today neither reads nor writes these columns, so applying it early
-- changes nothing at all. Run once. Safe to re-run.

alter table public.orders add column if not exists restored_at timestamptz;
alter table public.orders add column if not exists restored_by text;
alter table public.orders add column if not exists payment_updated_by text;

------------------------------------------------------------------------------
-- Prove it took, and prove nothing was touched
--
-- 20 reported success three times while doing nothing, so this checks its own
-- work: the three columns must exist, and every one of them must be entirely
-- null, which it can only be if no existing row was written to.
------------------------------------------------------------------------------

do $$
declare
  v_columns int;
  v_touched int;
begin
  select count(*) into v_columns
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'orders'
     and column_name in ('restored_at', 'restored_by', 'payment_updated_by');

  if v_columns <> 3 then
    raise exception 'Expected 3 new columns on public.orders, found %.', v_columns;
  end if;

  select count(*) into v_touched
    from public.orders
   where restored_at is not null
      or restored_by is not null
      or payment_updated_by is not null;

  if v_touched <> 0 then
    raise exception
      'Expected every existing sale to be left alone, but % already carry a value.', v_touched;
  end if;
end $$;
