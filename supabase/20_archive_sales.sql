-- Archiving a sale instead of deleting it (client request, 2026-10-09)
--
-- A mis-keyed sale had to be deleted, and a deleted sale was gone: no undo, no
-- record that it ever existed, and the day's takings quietly changed with no
-- way to see why. Sales are now archived instead. An archived sale leaves the
-- records, the totals and every report, but the row and its services, add-ons
-- and payment proof all stay exactly where they are and can be brought back.
--
-- 1. orders gains archived_at (null means active) and archived_by, so it is
--    possible to see when a sale was taken out and by whom.
-- 2. A partial index covers the list query, which now always asks for the
--    active sales newest first. Without it that filter would read every row.
-- 3. The app's delete policy on orders is DROPPED. The app can no longer
--    destroy a sale at all, only archive one, so there is no code path left
--    that loses a sale. An admin can still purge one from the SQL editor if
--    that is ever genuinely wanted.
--
-- Archiving is an ordinary update, already allowed by "Authenticated can
-- update orders", so no new write policy is needed.
--
-- STILL DESTRUCTIVE AFTER THIS: deleting a WORKER. orders.worker_id is
-- ON DELETE CASCADE (09), and a cascade is enforced by the foreign key rather
-- than by a policy, so removing a worker still removes their sales for good.
-- Changing that is a separate decision; the app warns before it happens.
--
-- RUN THIS BEFORE DEPLOYING THE APP VERSION THAT ARCHIVES. It is additive and
-- the version live today neither reads nor writes these columns, so applying
-- it early changes nothing. Run once. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------

alter table public.orders add column if not exists archived_at timestamptz;
alter table public.orders add column if not exists archived_by text;

------------------------------------------------------------------------------
-- 2. The index the sales list now needs
--
-- Every list and report asks for active sales, newest first. The existing
-- created_at index cannot serve that filter, so without this each load would
-- read the whole table and sort it.
------------------------------------------------------------------------------

create index if not exists orders_active_created_at_idx
  on public.orders (created_at desc, id desc)
  where archived_at is null;

------------------------------------------------------------------------------
-- 3. The app can no longer delete a sale
--
-- Dropped rather than left in place: a policy that exists is a policy some
-- future code path can use by accident, and the whole point of this change is
-- that a sale cannot be lost.
--
-- Both names are dropped. 09 created "Authenticated can delete orders"; 14
-- replaced it with the role-aware "admins and secretaries delete sales". The
-- first run of this file only named the 09 policy, and because "if exists"
-- reports nothing when it matches nothing, the drop passed while deletion was
-- still live. Dropping both keeps this correct whether the database came
-- through 14 or is being rebuilt from scratch.
------------------------------------------------------------------------------

drop policy if exists "Authenticated can delete orders" on public.orders;
drop policy if exists "admins and secretaries delete sales" on public.orders;

-- Fails loudly rather than quietly leaving a way to destroy a sale.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'orders' and cmd = 'DELETE'
  ) then
    raise exception
      'A delete policy still exists on public.orders. Archiving is not safe until it is gone.';
  end if;
end $$;
