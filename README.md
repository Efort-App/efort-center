# Efort Center

Internal dashboard for Efort Center.

## What is in here

- **Analytics dashboard** backed by Firebase Auth + Firestore
- **Tasks workspace** backed by Supabase, exposed through Firebase callable functions
- **Site menu** with:
  - `/` → Analytics
  - `/tasks` → Tasks

## Frontend setup

1. Copy `.env.example` to `.env`
2. Fill the Firebase web config values
3. Install dependencies
   ```bash
   npm install
   ```
4. Run locally
   ```bash
   npm run dev
   ```

### Local demo mode (optional)

If you want the `/tasks` workspace to use mock/demo data during local development only, put this in `.env.development.local`:

```bash
VITE_TASKS_BACKEND=mock
```

Do **not** use `.env.local` for this, because Vite also loads it during production builds.

## Supabase setup

1. Create/select the Supabase project for **Efort Center**
2. Open the SQL editor
3. Run:
   - `supabase/efort_center_setup.sql`

This creates:
- `task_owners`
- `tasks`
- `task_events`

It also seeds:
- `Ben`
- `Barney`

## Firebase Functions setup

Install function deps:

```bash
cd functions
npm install
cd ..
```

Set Firebase function secrets:

```bash
firebase functions:secrets:set SUPABASE_URL
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
firebase functions:secrets:set TASKS_ADMIN_EMAILS
```

Recommended value for `TASKS_ADMIN_EMAILS`:
- comma-separated admin emails allowed to create/update tasks

## Deploy

Deploy the task functions:

```bash
firebase deploy --only functions:listTaskOwners,functions:listTaskTemplates,functions:listTaskSchedules,functions:listTasks,functions:createTask,functions:updateTask,functions:saveTaskSchedule,functions:createTaskTemplate,functions:updateTaskTemplate,functions:deleteTaskTemplate,functions:createTaskFromTemplate --project efort-app
```

Deploy hosting:

```bash
npm run deploy:hosting
```

`deploy:hosting` forces `VITE_TASKS_BACKEND=firebase` so production does not accidentally ship the local mock backend.

## Architecture

### Analytics
- Firebase Auth
- Firestore reads directly in the client
- existing callable: `getMetaInsights`

### Tasks
- Firebase Auth in the client
- Firebase callable functions as the secure backend layer
- Supabase Postgres as the task system of record
- Supabase service role stays server-side only

This keeps the app secure without exposing privileged Supabase access in the browser.
