-- MK4 Carwash POS - live schema snapshot, read from the database on 2026-10-02
--
-- The base schema (01 Tables, 02 Policies, 03 Seed Sample Workers) was only
-- ever kept as saved snippets in the Supabase SQL editor, so the repo could
-- not rebuild the database. This file records what is actually deployed after
-- 01-04 and 06-09 plus payment_proofs.sql and keep_alive.sql were applied,
-- taken from the system catalogs rather than from the migration files.
--
-- Every statement is idempotent, so this can stand up a fresh project. On the
-- live project it should be a no-op. Sample worker seeding (03) is left out.

------------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------------

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text default 'Washer',
  phone text,
  address text,
  status text default 'Active',
  date_joined date,
  notes text,
  commission_mode text default 'inherit',
  commission_value numeric default 0,
  profile_image_url text, -- unused by the app
  created_at timestamptz default now()
);

create table if not exists public.commission_settings (
  id uuid primary key default gen_random_uuid(),
  global_mode text default 'service_percent',
  global_value numeric default 0,
  updated_at timestamptz default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  sales_order_id text unique not null,
  order_date date not null,
  plate_number text not null,
  customer_name text,
  contact_number text,
  car_type text,
  worker_id uuid,
  worker_name text,
  manager text,
  service_total numeric default 0,
  addon_total numeric default 0,
  cash numeric default 0,
  gcash numeric default 0,
  credit numeric default 0,
  discount numeric default 0,
  total numeric default 0,
  total_paid numeric default 0,
  balance numeric default 0,
  commission numeric default 0,
  commission_label text,
  reference_no text,
  payment_notes text,
  payment_updated_at timestamptz,
  photo_url text, -- unused by the app; photo_path holds the storage key
  photo_path text,
  notes text,
  created_at timestamptz default now(),
  gcash_ref text,
  credit_ref text,
  car_brand text,
  photo_name text,
  payment_enabled jsonb not null
    default '{"cash":false,"gcash":false,"credit":false,"discount":false}'::jsonb
);

-- 09: deleting a worker deletes their sales.
alter table public.orders drop constraint if exists orders_worker_id_fkey;
alter table public.orders
  add constraint orders_worker_id_fkey
  foreign key (worker_id) references public.workers(id) on delete cascade;

create table if not exists public.order_services (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  category text not null,
  size text not null,
  price numeric default 0,
  commission_type text,
  commission_rate numeric default 0,
  created_at timestamptz default now()
);

create table if not exists public.order_addons (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  name text not null,
  price numeric default 0,
  created_at timestamptz default now()
);

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

create table if not exists public.keep_alive (
  id smallint primary key,
  note text not null default 'Placeholder row so the keep-alive cron has something to SELECT.',
  created_at timestamptz not null default now(),
  constraint keep_alive_single_row check (id = 1)
);

-- 06: price list names are unique.
create unique index if not exists service_categories_category_key
  on public.service_categories (category);
create unique index if not exists add_ons_name_key
  on public.add_ons (name);
create unique index if not exists service_items_category_size_key
  on public.service_items (category_id, size);

------------------------------------------------------------------------------
-- Row level security: enabled on every table
------------------------------------------------------------------------------

alter table public.workers enable row level security;
alter table public.commission_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_services enable row level security;
alter table public.order_addons enable row level security;
alter table public.service_categories enable row level security;
alter table public.service_items enable row level security;
alter table public.add_ons enable row level security;
alter table public.keep_alive enable row level security;

------------------------------------------------------------------------------
-- Policies (28 live, listed by table)
------------------------------------------------------------------------------

-- workers: anon can read every row and column (08 widened 02's
-- status = 'Active' filter to true). Staff have full access.
drop policy if exists "Public can read active workers" on public.workers;
create policy "Public can read active workers"
  on public.workers for select to anon, authenticated using (true);
drop policy if exists "Authenticated can read all workers" on public.workers;
create policy "Authenticated can read all workers"
  on public.workers for select to authenticated using (true);
drop policy if exists "Authenticated can insert workers" on public.workers;
create policy "Authenticated can insert workers"
  on public.workers for insert to authenticated with check (true);
drop policy if exists "Authenticated can update workers" on public.workers;
create policy "Authenticated can update workers"
  on public.workers for update to authenticated using (true) with check (true);
drop policy if exists "Authenticated can delete workers" on public.workers;
create policy "Authenticated can delete workers"
  on public.workers for delete to authenticated using (true);

-- commission_settings: no insert policy, so the app can only update the
-- row 01 seeded.
drop policy if exists "Public can read commission settings" on public.commission_settings;
create policy "Public can read commission settings"
  on public.commission_settings for select to anon, authenticated using (true);
drop policy if exists "Authenticated can read commission settings" on public.commission_settings;
create policy "Authenticated can read commission settings"
  on public.commission_settings for select to authenticated using (true);
drop policy if exists "Authenticated can update commission settings" on public.commission_settings;
create policy "Authenticated can update commission settings"
  on public.commission_settings for update to authenticated using (true) with check (true);

-- orders: anon can insert but never read back. Staff read, update, delete.
drop policy if exists "Public can insert orders" on public.orders;
create policy "Public can insert orders"
  on public.orders for insert to anon, authenticated with check (true);
drop policy if exists "Authenticated can read orders" on public.orders;
create policy "Authenticated can read orders"
  on public.orders for select to authenticated using (true);
drop policy if exists "Authenticated can update orders" on public.orders;
create policy "Authenticated can update orders"
  on public.orders for update to authenticated using (true) with check (true);
drop policy if exists "Authenticated can delete orders" on public.orders;
create policy "Authenticated can delete orders"
  on public.orders for delete to authenticated using (true);

-- order_services
drop policy if exists "Public can insert order services" on public.order_services;
create policy "Public can insert order services"
  on public.order_services for insert to anon, authenticated with check (true);
drop policy if exists "Authenticated can read order services" on public.order_services;
create policy "Authenticated can read order services"
  on public.order_services for select to authenticated using (true);
drop policy if exists "Authenticated can delete order services" on public.order_services;
create policy "Authenticated can delete order services"
  on public.order_services for delete to authenticated using (true);

-- order_addons
drop policy if exists "Public can insert order addons" on public.order_addons;
create policy "Public can insert order addons"
  on public.order_addons for insert to anon, authenticated with check (true);
drop policy if exists "Authenticated can read order addons" on public.order_addons;
create policy "Authenticated can read order addons"
  on public.order_addons for select to authenticated using (true);
drop policy if exists "Authenticated can delete order addons" on public.order_addons;
create policy "Authenticated can delete order addons"
  on public.order_addons for delete to authenticated using (true);

-- Price list: anyone reads, staff manage.
drop policy if exists "Public can read service categories" on public.service_categories;
create policy "Public can read service categories"
  on public.service_categories for select to anon, authenticated using (true);
drop policy if exists "staff manage service categories" on public.service_categories;
create policy "staff manage service categories"
  on public.service_categories for all to authenticated using (true) with check (true);

drop policy if exists "Public can read service items" on public.service_items;
create policy "Public can read service items"
  on public.service_items for select to anon, authenticated using (true);
drop policy if exists "staff manage service items" on public.service_items;
create policy "staff manage service items"
  on public.service_items for all to authenticated using (true) with check (true);

drop policy if exists "Public can read add ons" on public.add_ons;
create policy "Public can read add ons"
  on public.add_ons for select to anon, authenticated using (true);
drop policy if exists "staff manage add ons" on public.add_ons;
create policy "staff manage add ons"
  on public.add_ons for all to authenticated using (true) with check (true);

drop policy if exists "keep_alive is readable by anyone" on public.keep_alive;
create policy "keep_alive is readable by anyone"
  on public.keep_alive for select to anon, authenticated using (true);

------------------------------------------------------------------------------
-- Storage
--
-- Also present and unused by the app: private buckets "proof-photos" and
-- "worker-profile-images" (no policies).
------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs', 'payment-proofs', false, 2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Staff only. Signed-out workers cannot upload a proof.
drop policy if exists "staff can upload payment proofs" on storage.objects;
create policy "staff can upload payment proofs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs');
drop policy if exists "staff can read payment proofs" on storage.objects;
create policy "staff can read payment proofs"
  on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs');
drop policy if exists "staff can delete payment proofs" on storage.objects;
create policy "staff can delete payment proofs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs');
