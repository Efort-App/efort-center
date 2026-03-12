-- Efort Center consolidated setup
-- This file mirrors the current Supabase migrations so the full task backend
-- can be initialized from the SQL editor in one run.

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

create or replace function public.is_task_schedule_time_valid(p_time text)
returns boolean
language sql
immutable
as $$
  select
    p_time ~ '^\d{2}:\d{2}$'
    and split_part(p_time, ':', 1)::int between 0 and 23
    and split_part(p_time, ':', 2)::int between 0 and 59
    and mod(split_part(p_time, ':', 2)::int, 15) = 0
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
    (rule_type = 'interval' and interval_minutes is not null and interval_minutes > 0 and mod(interval_minutes, 15) = 0)
    or
    (rule_type in ('daily', 'weekly') and public.is_task_schedule_time_valid(time_of_day))
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_run_status') THEN
    CREATE TYPE public.task_run_status AS ENUM (
      'queued',
      'dispatched',
      'running',
      'blocked',
      'waiting_human',
      'done',
      'failed'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_run_update_kind') THEN
    CREATE TYPE public.task_run_update_kind AS ENUM (
      'status_change',
      'progress',
      'note',
      'blocker',
      'subagent_started',
      'subagent_finished',
      'system'
    );
  END IF;
END
$$;

alter table public.task_schedules
  add column if not exists agent_slug text not null default 'ben',
  add column if not exists next_run_at timestamptz,
  add column if not exists last_dispatched_at timestamptz,
  add column if not exists last_dispatch_error text;

create table if not exists public.task_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  schedule_id uuid references public.task_schedules(id) on delete set null,
  due_slot timestamptz,
  agent_slug text not null,
  status public.task_run_status not null default 'queued',
  progress_percent integer,
  current_step text,
  latest_update text,
  openclaw_session_key text,
  openclaw_message_id text,
  started_at timestamptz not null default timezone('utc', now()),
  last_heartbeat_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.task_run_updates (
  id uuid primary key default gen_random_uuid(),
  task_run_id uuid not null references public.task_runs(id) on delete cascade,
  kind public.task_run_update_kind not null default 'note',
  status public.task_run_status,
  progress_percent integer,
  current_step text,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
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

drop trigger if exists task_runs_set_updated_at on public.task_runs;
create trigger task_runs_set_updated_at
before update on public.task_runs
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
create unique index if not exists task_runs_schedule_due_slot_uidx
  on public.task_runs (schedule_id, due_slot)
  where schedule_id is not null and due_slot is not null;
create index if not exists task_runs_task_id_idx on public.task_runs (task_id, created_at desc);
create index if not exists task_runs_status_idx on public.task_runs (status, updated_at desc);
create index if not exists task_run_updates_task_run_id_idx on public.task_run_updates (task_run_id, created_at desc);
create index if not exists task_schedules_next_run_at_idx on public.task_schedules (is_active, next_run_at);

alter table public.task_owners enable row level security;
alter table public.task_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.task_schedules enable row level security;
alter table public.task_events enable row level security;
alter table public.task_runs enable row level security;
alter table public.task_run_updates enable row level security;

create or replace function public.compute_next_schedule_run(
  p_rule_type public.schedule_rule_type,
  p_interval_minutes integer,
  p_time_of_day text,
  p_weekdays_json jsonb,
  p_from timestamptz,
  p_timezone text default 'Europe/Madrid'
)
returns timestamptz
language plpgsql
as $$
declare
  v_tz text := coalesce(nullif(p_timezone, ''), 'Europe/Madrid');
  v_local timestamp;
  v_time time := coalesce(nullif(p_time_of_day, '')::time, time '12:00');
  v_candidate timestamp;
  v_dow text;
  v_weekdays text[];
  v_i integer;
begin
  if p_rule_type = 'interval' then
    return p_from + make_interval(mins => greatest(coalesce(p_interval_minutes, 15), 1));
  end if;

  v_local := p_from at time zone v_tz;

  if p_rule_type = 'daily' then
    v_candidate := date_trunc('day', v_local) + v_time;
    if v_candidate <= v_local then
      v_candidate := v_candidate + interval '1 day';
    end if;
    return v_candidate at time zone v_tz;
  end if;

  v_weekdays := array(
    select jsonb_array_elements_text(coalesce(p_weekdays_json, '[]'::jsonb))
  );

  if array_length(v_weekdays, 1) is null then
    v_weekdays := array['mon'];
  end if;

  for v_i in 0..7 loop
    v_candidate := date_trunc('day', v_local) + (v_i || ' day')::interval + v_time;
    v_dow := lower(to_char(v_candidate, 'dy'));
    if v_dow = any(v_weekdays) and v_candidate > v_local then
      return v_candidate at time zone v_tz;
    end if;
  end loop;

  return (date_trunc('day', v_local) + interval '7 day' + v_time) at time zone v_tz;
end;
$$;

update public.task_schedules
set next_run_at = coalesce(
  next_run_at,
  case
    when rule_type = 'interval' then timezone('utc', now()) + make_interval(mins => greatest(coalesce(interval_minutes, 15), 1))
    when rule_type in ('daily', 'weekly') then public.compute_next_schedule_run(rule_type, interval_minutes, time_of_day, weekdays_json, timezone('utc', now()), timezone)
    else timezone('utc', now()) + interval '15 minutes'
  end
)
where next_run_at is null;

create or replace function public.claim_due_task_schedules(
  p_now timestamptz default timezone('utc', now()),
  p_limit integer default 25
)
returns table (
  id uuid,
  task_id uuid,
  template_id uuid,
  owner_id uuid,
  agent_slug text,
  priority public.task_priority,
  rule_type public.schedule_rule_type,
  interval_minutes integer,
  time_of_day text,
  weekdays_json jsonb,
  timezone text,
  due_slot timestamptz,
  next_run_at timestamptz,
  name text
)
language plpgsql
security definer
as $$
begin
  return query
  with due as (
    select s.id as schedule_id, s.next_run_at as due_slot
    from public.task_schedules s
    where s.is_active = true
      and s.next_run_at is not null
      and s.next_run_at <= p_now
    order by s.next_run_at asc
    for update skip locked
    limit greatest(coalesce(p_limit, 25), 1)
  ), updated as (
    update public.task_schedules s
    set
      last_dispatched_at = p_now,
      last_dispatch_error = null,
      next_run_at = public.compute_next_schedule_run(
        s.rule_type,
        s.interval_minutes,
        s.time_of_day,
        s.weekdays_json,
        due.due_slot,
        s.timezone
      )
    from due
    where s.id = due.schedule_id
    returning
      s.id,
      s.task_id,
      s.template_id,
      s.owner_id,
      s.agent_slug,
      s.priority,
      s.rule_type,
      s.interval_minutes,
      s.time_of_day,
      s.weekdays_json,
      s.timezone,
      due.due_slot,
      s.next_run_at,
      s.name
  )
  select * from updated;
end;
$$;

create or replace function public.claim_next_queued_task_runs(
  p_agent_slug text,
  p_machine_name text,
  p_limit integer default 1
)
returns table (
  task_run_id uuid,
  task_id uuid,
  schedule_id uuid,
  agent_slug text,
  title text,
  description text,
  priority public.task_priority,
  owner_id uuid,
  template_id uuid,
  openclaw_session_key text,
  metadata jsonb
)
language plpgsql
security definer
as $$
begin
  return query
  with picked as (
    select tr.id
    from public.task_runs tr
    where tr.status = 'queued'
      and tr.agent_slug = p_agent_slug
    order by tr.created_at asc
    for update skip locked
    limit greatest(coalesce(p_limit, 1), 1)
  ), updated as (
    update public.task_runs tr
    set
      status = 'dispatched',
      current_step = 'Claimed by OpenClaw worker',
      latest_update = 'Run claimed by local OpenClaw worker.',
      last_heartbeat_at = timezone('utc', now()),
      metadata = coalesce(tr.metadata, '{}'::jsonb) || jsonb_build_object(
        'machine_name', p_machine_name,
        'claimed_at', timezone('utc', now())
      )
    where tr.id in (select id from picked)
    returning tr.*
  )
  select
    updated.id as task_run_id,
    updated.task_id,
    updated.schedule_id,
    updated.agent_slug,
    t.title,
    t.description,
    t.priority,
    t.owner_id,
    t.template_id,
    updated.openclaw_session_key,
    updated.metadata
  from updated
  join public.tasks t on t.id = updated.task_id;
end;
$$;

insert into public.task_owners (slug, name, kind, is_active)
values
  ('ben', 'Ben', 'agent', true),
  ('barney', 'Barney', 'agent', true)
on conflict (slug)
do update set
  name = excluded.name,
  kind = excluded.kind,
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());
