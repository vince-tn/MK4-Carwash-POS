-- MK4 Carwash POS - 04 App alignment
--
-- Brings the existing schema (01 Tables / 02 Policies) in line with what the
-- app actually stores, adds the missing pricing tables, and closes an
-- anon-insert hole.
--
-- Safe to re-run.

------------------------------------------------------------------------------
-- 1. Columns the app writes but the orders table does not have yet
------------------------------------------------------------------------------

-- References are captured per payment method, not as one free-text field.
alter table public.orders add column if not exists gcash_ref text;
alter table public.orders add column if not exists credit_ref text;

-- Millet asked for car brand alongside the existing car_type (a size tier).
alter table public.orders add column if not exists car_brand text;

-- The original filename of the proof image, shown next to the View link.
-- photo_path already exists and holds the object key inside the bucket.
alter table public.orders add column if not exists photo_name text;

-- The form tracks which payment methods are ticked. Without this, a 0.00 cash
-- amount is indistinguishable from "cash was not used", which changes totals.
alter table public.orders
  add column if not exists payment_enabled jsonb not null
  default '{"cash":false,"gcash":false,"credit":false,"discount":false}'::jsonb;

------------------------------------------------------------------------------
-- 2. Pricing tables
--
-- The Services admin page edits categories, their per-size prices and the
-- add-on list. None of that had anywhere to live, so every device kept its
-- own price list -- two tills could quietly charge different prices.
------------------------------------------------------------------------------

create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  commission_type text,
  commission_rate numeric default 0,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.service_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.service_categories(id) on delete cascade,
  size text not null,
  price numeric default 0,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.add_ons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric default 0,
  sort_order integer default 0,
  created_at timestamptz default now()
);

alter table public.service_categories enable row level security;
alter table public.service_items enable row level security;
alter table public.add_ons enable row level security;

-- Signed-in staff manage the price list; nobody else can read or touch it.
drop policy if exists "staff manage service categories" on public.service_categories;
create policy "staff manage service categories"
  on public.service_categories for all to authenticated
  using (true) with check (true);

drop policy if exists "staff manage service items" on public.service_items;
create policy "staff manage service items"
  on public.service_items for all to authenticated
  using (true) with check (true);

drop policy if exists "staff manage add ons" on public.add_ons;
create policy "staff manage add ons"
  on public.add_ons for all to authenticated
  using (true) with check (true);

------------------------------------------------------------------------------
-- 3. Security: anon must not be able to write sales orders
--
-- The publishable key is embedded in the public JS bundle, so an anon INSERT
-- policy lets anyone on the internet post fabricated sales into the POS.
-- Every real write comes from a signed-in member of staff.
------------------------------------------------------------------------------

drop policy if exists "Public can insert orders" on public.orders;
drop policy if exists "Authenticated can insert orders" on public.orders;
create policy "Authenticated can insert orders"
  on public.orders for insert to authenticated with check (true);

drop policy if exists "Public can insert order services" on public.order_services;
drop policy if exists "Authenticated can insert order services" on public.order_services;
create policy "Authenticated can insert order services"
  on public.order_services for insert to authenticated with check (true);

drop policy if exists "Public can insert order addons" on public.order_addons;
drop policy if exists "Authenticated can insert order addons" on public.order_addons;
create policy "Authenticated can insert order addons"
  on public.order_addons for insert to authenticated with check (true);

-- The worker list is staff-only too; it carries names, phones and addresses.
drop policy if exists "Public can read active workers" on public.workers;

-- Editing a saved order's services/add-ons requires replacing the child rows.
drop policy if exists "Authenticated can delete order services" on public.order_services;
create policy "Authenticated can delete order services"
  on public.order_services for delete to authenticated using (true);

drop policy if exists "Authenticated can delete order addons" on public.order_addons;
create policy "Authenticated can delete order addons"
  on public.order_addons for delete to authenticated using (true);
