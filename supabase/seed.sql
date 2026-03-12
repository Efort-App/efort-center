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
