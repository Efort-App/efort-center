create or replace function public.broadcast_tasks_workspace_change()
returns trigger
language plpgsql
security definer
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'table', tg_table_name,
      'operation', tg_op,
      'at', timezone('utc', now())
    ),
    'workspace_changed',
    'efort-tasks-workspace',
    false
  );

  return null;
end;
$$;

drop trigger if exists task_templates_broadcast_workspace_change on public.task_templates;
create trigger task_templates_broadcast_workspace_change
after insert or update or delete on public.task_templates
for each row execute function public.broadcast_tasks_workspace_change();

drop trigger if exists tasks_broadcast_workspace_change on public.tasks;
create trigger tasks_broadcast_workspace_change
after insert or update or delete on public.tasks
for each row execute function public.broadcast_tasks_workspace_change();

drop trigger if exists task_schedules_broadcast_workspace_change on public.task_schedules;
create trigger task_schedules_broadcast_workspace_change
after insert or update or delete on public.task_schedules
for each row execute function public.broadcast_tasks_workspace_change();

drop trigger if exists task_runs_broadcast_workspace_change on public.task_runs;
create trigger task_runs_broadcast_workspace_change
after insert or update or delete on public.task_runs
for each row execute function public.broadcast_tasks_workspace_change();

drop trigger if exists task_run_updates_broadcast_workspace_change on public.task_run_updates;
create trigger task_run_updates_broadcast_workspace_change
after insert or update or delete on public.task_run_updates
for each row execute function public.broadcast_tasks_workspace_change();
