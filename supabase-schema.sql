-- Run once in Supabase SQL Editor. Row Level Security makes each user's data private.
create table if not exists public.lotto_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{"draws":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.lotto_user_data enable row level security;
drop policy if exists "Users can read their own lotto data" on public.lotto_user_data;
create policy "Users can read their own lotto data" on public.lotto_user_data for select using (auth.uid() = user_id);
drop policy if exists "Users can insert their own lotto data" on public.lotto_user_data;
create policy "Users can insert their own lotto data" on public.lotto_user_data for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update their own lotto data" on public.lotto_user_data;
create policy "Users can update their own lotto data" on public.lotto_user_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
