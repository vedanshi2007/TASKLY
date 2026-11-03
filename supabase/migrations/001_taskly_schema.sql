create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.tasks enable row level security;
create policy "Users manage their own tasks" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "Users manage their own push subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  task_title text not null,
  scheduled_for timestamptz not null,
  reminder_type text not null check (reminder_type in ('before_due','overdue')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, task_id, scheduled_for, reminder_type)
);
alter table public.reminder_jobs enable row level security;
create policy "Users read their own reminder jobs" on public.reminder_jobs for select using (auth.uid() = user_id);
create index if not exists tasks_user_updated_idx on public.tasks(user_id, updated_at desc);
create index if not exists reminder_jobs_due_idx on public.reminder_jobs(scheduled_for) where sent_at is null;
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);