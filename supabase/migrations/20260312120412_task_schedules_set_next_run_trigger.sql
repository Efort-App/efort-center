create or replace function public.set_task_schedule_next_run_at()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.is_active, true) = false then
    new.next_run_at = null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.next_run_at is null then
      new.next_run_at = public.compute_next_schedule_run(
        new.rule_type,
        new.interval_minutes,
        new.time_of_day,
        new.weekdays_json,
        timezone('utc', now()),
        new.timezone
      );
    end if;
    return new;
  end if;

  if new.next_run_at is null
    or old.rule_type is distinct from new.rule_type
    or old.interval_minutes is distinct from new.interval_minutes
    or old.time_of_day is distinct from new.time_of_day
    or old.weekdays_json is distinct from new.weekdays_json
    or old.timezone is distinct from new.timezone
    or old.is_active is distinct from new.is_active
    or old.task_id is distinct from new.task_id
    or old.template_id is distinct from new.template_id
  then
    new.next_run_at = public.compute_next_schedule_run(
      new.rule_type,
      new.interval_minutes,
      new.time_of_day,
      new.weekdays_json,
      timezone('utc', now()),
      new.timezone
    );
  end if;

  return new;
end;
$$;

drop trigger if exists task_schedules_set_next_run_at on public.task_schedules;
create trigger task_schedules_set_next_run_at
before insert or update on public.task_schedules
for each row execute function public.set_task_schedule_next_run_at();
