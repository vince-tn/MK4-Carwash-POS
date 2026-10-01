-- Repair: remove the duplicated price list, then make duplicates impossible
--
-- The first seed ran twice (a reload while the first was still in flight),
-- leaving 2 rows per service category and 2 per add-on. Only one copy of each
-- category has sizes under it; the other is empty, which is why half the
-- entries in the dropdown had no Package / Size.
--
-- seedPricing now matches on name and only inserts what is missing, so a
-- repeat seed is a no-op. The unique indexes below make it impossible for any
-- future code path to reintroduce this.
--
-- Run once, then reload the app. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Collapse duplicate categories
--
-- Keeps, per name, whichever copy actually has sizes under it; ties go to the
-- older row. Deleting a category cascades to its service_items, and the rows
-- being deleted here have none.
------------------------------------------------------------------------------

with ranked as (
  select
    c.id,
    row_number() over (
      partition by c.category
      order by
        (select count(*) from public.service_items i where i.category_id = c.id) desc,
        c.created_at asc
    ) as rn
  from public.service_categories c
)
delete from public.service_categories
where id in (select id from ranked where rn > 1);

------------------------------------------------------------------------------
-- 2. Collapse duplicate add-ons, keeping the oldest of each name
------------------------------------------------------------------------------

with ranked as (
  select
    id,
    row_number() over (partition by name order by created_at asc) as rn
  from public.add_ons
)
delete from public.add_ons
where id in (select id from ranked where rn > 1);

------------------------------------------------------------------------------
-- 3. Collapse any duplicate sizes within a category
------------------------------------------------------------------------------

with ranked as (
  select
    id,
    row_number() over (
      partition by category_id, size order by created_at asc
    ) as rn
  from public.service_items
)
delete from public.service_items
where id in (select id from ranked where rn > 1);

------------------------------------------------------------------------------
-- 4. Make it structurally impossible from here on
------------------------------------------------------------------------------

create unique index if not exists service_categories_category_key
  on public.service_categories (category);

create unique index if not exists add_ons_name_key
  on public.add_ons (name);

create unique index if not exists service_items_category_size_key
  on public.service_items (category_id, size);
