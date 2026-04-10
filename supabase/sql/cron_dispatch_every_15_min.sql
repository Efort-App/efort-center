-- Run this after deploying the `dispatch-scheduled-tasks` edge function.
-- Use a local-only bearer token in the Authorization header below.
-- Never commit a real token to git.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('efort_center_dispatch_scheduled_tasks')
where exists (
  select 1 from cron.job where jobname = 'efort_center_dispatch_scheduled_tasks'
);

select cron.schedule(
  'efort_center_dispatch_scheduled_tasks',
  '*/15 * * * *',
  $$
  select
    net.http_post(
      url := 'https://<PROJECT-REF>.supabase.co/functions/v1/dispatch-scheduled-tasks',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <DISPATCH_BEARER_TOKEN>'
      ),
      body := jsonb_build_object('limit', 25)
    );
  $$
);
