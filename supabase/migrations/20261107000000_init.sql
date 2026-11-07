-- SkyView 3D — Supabase schema (auth users are managed by Supabase Auth).
-- Apply with the Supabase CLI (`supabase db push`) or paste into Dashboard → SQL Editor.

-- Profile row per user (created automatically on sign-up).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy "profiles: read own" on public.profiles for select using (auth.uid() = id);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Subscriptions (written only by the Worker with the service-role key; users can read their own).
create table if not exists public.subscriptions (
  id text primary key,                         -- provider subscription id (sub_...)
  provider text not null check (provider in ('razorpay', 'stripe', 'mock')),
  user_id uuid references auth.users (id) on delete set null,
  plan_id text,                                -- pro_monthly | pro_yearly
  status text not null,                        -- created | authenticated | active | pending | halted | cancelled | completed | expired | paused
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, updated_at desc);

alter table public.subscriptions enable row level security;
create policy "subscriptions: read own" on public.subscriptions for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only the service role (which bypasses RLS) may write.

-- Webhook idempotency log.
create table if not exists public.billing_events (
  id text primary key,                         -- provider event id
  payload jsonb,
  received_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;
-- No policies: service role only.
