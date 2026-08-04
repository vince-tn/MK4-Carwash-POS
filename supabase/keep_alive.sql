create table if not exists public.keep_alive (
  id smallint primary key,
  note text not null default 'Placeholder row so the keep-alive cron has something to SELECT.',
  created_at timestamptz not null default now(),
  constraint keep_alive_single_row check (id = 1)
);

insert into public.keep_alive (id) values (1) on conflict (id) do nothing;

alter table public.keep_alive enable row level security;

drop policy if exists "keep_alive is readable by anyone" on public.keep_alive;
create policy "keep_alive is readable by anyone"
  on public.keep_alive
  for select
  to anon, authenticated
  using (true);
