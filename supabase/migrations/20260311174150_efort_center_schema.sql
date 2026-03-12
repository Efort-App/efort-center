create extension if not exists pgcrypto;

create schema if not exists app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE public.task_status AS ENUM ('todo', 'doing', 'done');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_priority') THEN
    CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_owner_kind') THEN
    CREATE TYPE public.task_owner_kind AS ENUM ('agent', 'human', 'system');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_rule_type') THEN
    CREATE TYPE public.schedule_rule_type AS ENUM ('daily', 'weekly', 'interval');
  END IF;
END
$$;

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.sync_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done' or old.completed_at is null) then
    new.completed_at = timezone('utc', now());
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create table if not exists public.task_owners (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind public.task_owner_kind not null default 'agent',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 200),
  description text not null default '',
  priority public.task_priority not null default 'medium',
  checklist_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '',
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  owner_id uuid references public.task_owners(id) on delete set null,
  template_id uuid references public.task_templates(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.task_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 200),
  task_id uuid references public.tasks(id) on delete cascade,
  template_id uuid references public.task_templates(id) on delete cascade,
  owner_id uuid references public.task_owners(id) on delete set null,
  priority public.task_priority not null default 'medium',
  rule_type public.schedule_rule_type not null,
  interval_minutes integer,
  time_of_day text,
  weekdays_json jsonb not null default '[]'::jsonb,
  timezone text not null default 'Europe/Madrid',
  is_active boolean not null default true,
  last_generated_at timestamptz,
  generated_run_keys jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint task_schedules_target_check check (
    ((task_id is not null)::int + (template_id is not null)::int) = 1
  ),
  constraint task_schedules_rule_check check (
    (rule_type = 'interval' and interval_minutes is not null and interval_minutes > 0)
    or
    (rule_type in ('daily', 'weekly') and time_of_day is not null)
  )
);

create table if not exists public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  template_id uuid references public.task_templates(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint task_events_target_check check (
    ((task_id is not null)::int + (template_id is not null)::int) >= 1
  )
);

drop trigger if exists task_owners_set_updated_at on public.task_owners;
create trigger task_owners_set_updated_at
before update on public.task_owners
for each row execute function public.set_current_timestamp_updated_at();

drop trigger if exists task_templates_set_updated_at on public.task_templates;
create trigger task_templates_set_updated_at
before update on public.task_templates
for each row execute function public.set_current_timestamp_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_current_timestamp_updated_at();

drop trigger if exists tasks_sync_completed_at on public.tasks;
create trigger tasks_sync_completed_at
before update on public.tasks
for each row execute function public.sync_task_completed_at();

drop trigger if exists task_schedules_set_updated_at on public.task_schedules;
create trigger task_schedules_set_updated_at
before update on public.task_schedules
for each row execute function public.set_current_timestamp_updated_at();

create index if not exists tasks_status_updated_at_idx on public.tasks (status, updated_at desc);
create index if not exists tasks_owner_id_idx on public.tasks (owner_id);
create index if not exists tasks_template_id_idx on public.tasks (template_id);
create index if not exists task_templates_updated_at_idx on public.task_templates (updated_at desc);
create index if not exists task_schedules_task_id_idx on public.task_schedules (task_id);
create index if not exists task_schedules_template_id_idx on public.task_schedules (template_id);
create index if not exists task_schedules_is_active_idx on public.task_schedules (is_active, rule_type);
create index if not exists task_events_task_created_at_idx on public.task_events (task_id, created_at desc);
create index if not exists task_events_template_created_at_idx on public.task_events (template_id, created_at desc);

alter table public.task_owners enable row level security;
alter table public.task_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.task_schedules enable row level security;
alter table public.task_events enable row level security;
