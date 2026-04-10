# Efort Center scheduling (Supabase queue + local OpenClaw poller)

This is the simple architecture:

- Supabase DB stores schedules, queued runs, and semantic progress updates
- Supabase cron checks due schedules every 15 minutes
- `dispatch-scheduled-tasks` Edge Function claims due schedules and creates queued task runs
- A local poller on the OpenClaw machine claims queued runs for its agent
- The local poller launches OpenClaw through a single configurable shell command
- OpenClaw (or the local worker around it) sends semantic progress updates to `report-task-progress`

## Files

- `migrations/20260311222000_task_dispatch_runtime.sql`
- `migrations/20260311224500_queue_claim_rpc.sql`
- `functions/dispatch-scheduled-tasks/index.ts`
- `functions/report-task-progress/index.ts`
- `sql/cron_dispatch_every_15_min.sql`
- `scripts/poll_queued_runs.mjs`

## Required Edge Function secrets

### dispatch-scheduled-tasks
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- local-only bearer token for cron calls (for this deployment we reuse `OPENCLAW_PROGRESS_TOKEN`)

### report-task-progress
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENCLAW_PROGRESS_TOKEN` (optional if you want to protect updates)

## Runtime flow

### 1. Supabase cron every 15 min
Cron calls `dispatch-scheduled-tasks`.

Use `sql/cron_dispatch_every_15_min.sql` as a local-only template and inject the live bearer token when applying it. Never commit a populated token into git.

### 2. Dispatcher queues work
The dispatcher:
- claims due schedules
- creates concrete tasks from templates if needed
- creates a `task_runs` row with status `queued`
- appends a `task_run_updates` row

### 3. Local OpenClaw machine polls
Run locally on the machine where OpenClaw lives:

```bash
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
OPENCLAW_AGENT=ben \
EFORT_MACHINE_NAME="Pol-MacBook-Air" \
EFORT_OPENCLAW_LAUNCH_CMD='YOUR_LOCAL_OPENCLAW_COMMAND' \
npm run poll:queued-runs
```

This script:
- claims queued runs for one agent (`ben` or `barney`)
- marks them as `running`
- appends a semantic update
- runs **one local shell command** with task data injected as environment variables

## Local launch contract
`poll_queued_runs.mjs` passes these environment variables into your command:

- `EFORT_TASK_RUN_ID`
- `EFORT_TASK_ID`
- `EFORT_SCHEDULE_ID`
- `EFORT_AGENT_SLUG`
- `EFORT_TASK_TITLE`
- `EFORT_TASK_DESCRIPTION`
- `EFORT_TASK_PROMPT`
- `EFORT_MACHINE_NAME`

So your local command can consume whichever parts it needs.

## Progress payload shape
The semantic update model is:

```json
{
  "taskRunId": "uuid",
  "status": "running",
  "kind": "progress",
  "currentStep": "Implementing task modal",
  "progressPercent": 45,
  "message": "Built the modal shell and started wiring save actions.",
  "metadata": {}
}
```

## Why this is simpler
- no public OpenClaw endpoint
- no Firebase task backend
- no raw logs
- scheduling fully in Supabase
- execution stays local on the OpenClaw machine
- only one local launch command remains configurable
