-- Indexes for the queries the app actually runs
--
-- An audit on 2026-10-02 found three foreign keys with no index behind them
-- and nothing supporting two lookups the app makes on every load or sale.
-- None of it shows with a handful of rows, which is how it went unnoticed;
-- all of it gets slower with every sale recorded.
--
-- 1. order_services.order_id and order_addons.order_id. Loading the sales
--    list embeds each order's services and add-ons, looked up by order_id
--    once per order. With no index, every lookup reads the whole child
--    table, so the list slows with the square of the number of sales.
--    Deleting a sale or a worker does the same lookup through ON DELETE
--    CASCADE.
-- 2. orders.worker_id. Deleting a worker finds that worker's sales through
--    this column (ON DELETE CASCADE, 09).
-- 3. orders.created_at. The sales list is fetched newest first, a page at a
--    time. Without this, every page sorts every order.
-- 4. orders.sales_order_id with text_pattern_ops. create_order (10) finds the
--    day's highest number with LIKE 'SO-<date>-%'. This database's collation
--    is en_US.UTF-8, and under it the existing unique index cannot serve a
--    LIKE prefix, so every sale read the whole orders table.
--
-- Also: a service or add-on row must belong to an order. order_id was
-- nullable on both; no such rows existed at the time of writing.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: the tables are tiny, so the
-- lock lasts milliseconds, and CONCURRENTLY cannot run inside the SQL
-- editor's transaction. Run once. Safe to re-run.

create index if not exists order_services_order_id_idx
  on public.order_services (order_id);

create index if not exists order_addons_order_id_idx
  on public.order_addons (order_id);

create index if not exists orders_worker_id_idx
  on public.orders (worker_id);

create index if not exists orders_created_at_idx
  on public.orders (created_at desc);

create index if not exists orders_sales_order_id_prefix_idx
  on public.orders (sales_order_id text_pattern_ops);

alter table public.order_services alter column order_id set not null;
alter table public.order_addons alter column order_id set not null;
