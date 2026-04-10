create or replace function public.resolve_task_schedule_agent_slug(p_owner_id uuid)
returns text
language plpgsql
as $$
declare
  v_slug text;
  v_kind public.task_owner_kind;
  v_is_active boolean;
begin
  if p_owner_id is null then
    return 'unassigned';
  end if;

  select slug, kind, is_active
  into v_slug, v_kind, v_is_active
  from public.task_owners
  where id = p_owner_id;

  if v_slug is null or v_kind is distinct from 'agent' or coalesce(v_is_active, false) = false then
    return 'unassigned';
  end if;

  return lower(v_slug);
end;
$$;

create or replace function public.sync_task_schedule_agent_slug()
returns trigger
language plpgsql
as $$
begin
  new.agent_slug = public.resolve_task_schedule_agent_slug(new.owner_id);
  return new;
end;
$$;

drop trigger if exists task_schedules_sync_agent_slug on public.task_schedules;
create trigger task_schedules_sync_agent_slug
before insert or update of owner_id on public.task_schedules
for each row execute function public.sync_task_schedule_agent_slug();

update public.task_schedules
set agent_slug = public.resolve_task_schedule_agent_slug(owner_id);
