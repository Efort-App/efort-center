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

create unique index if not exists task_runs_schedule_due_slot_uidx
  on public.task_runs (schedule_id, due_slot)
  where schedule_id is not null and due_slot is not null;

create index if not exists task_runs_task_id_idx on public.task_runs (task_id, created_at desc);
create index if not exists task_runs_status_idx on public.task_runs (status, updated_at desc);
create index if not exists task_run_updates_task_run_id_idx on public.task_run_updates (task_run_id, created_at desc);
create index if not exists task_schedules_next_run_at_idx on public.task_schedules (is_active, next_run_at);

drop trigger if exists task_runs_set_updated_at on public.task_runs;
create trigger task_runs_set_updated_at
before update on public.task_runs
for each row execute function public.set_current_timestamp_updated_at();

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
