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
