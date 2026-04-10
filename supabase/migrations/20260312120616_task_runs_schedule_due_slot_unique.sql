drop index if exists public.task_runs_schedule_due_slot_uidx;
create unique index if not exists task_runs_schedule_due_slot_uidx
  on public.task_runs (schedule_id, due_slot);
