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

alter table public.task_schedules
  add constraint task_schedules_interval_15_min_check
  check (
    rule_type <> 'interval'
    or (
      interval_minutes is not null
      and interval_minutes > 0
      and mod(interval_minutes, 15) = 0
    )
  );

alter table public.task_schedules
  add constraint task_schedules_time_15_min_check
  check (
    rule_type not in ('daily', 'weekly')
    or public.is_task_schedule_time_valid(time_of_day)
  );
