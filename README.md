# Efort Center

Internal dashboard for Efort Center.

## Workspaces

- `/` Analytics dashboard backed by Firebase Auth + Firestore
- `/feedback` Feedback workspace backed by the Firebase `feedback` collection
- `/tasks` Tasks workspace backed by Firebase callable functions + Supabase

The analytics, feedback, and tasks UIs share a workspace menu that stays left-aligned on larger screens and becomes an icon-only top-left hamburger that opens a full-height drawer on smaller screens. Dashboard access is controlled in [src/accessControl.js](/Users/polcortes/Documents/EfortCenter/src/accessControl.js).

In `/tasks`, tasks can be created from the board and deleted from the task detail modal. Template deletion remains in the template detail modal.

## Frontend setup

1. Copy `.env.example` to `.env` and fill the Firebase web config values.
2. Install dependencies:

```bash
npm install
```

3. Run locally:

```bash
npm run dev
```

### Local tasks demo mode

To run `/tasks` against local mock data, add this to `.env.development.local`:

```bash
VITE_TASKS_BACKEND=mock
```

Do not use `.env.local` for this, because Vite also loads it for production builds.

## Access

Only these Google accounts currently have dashboard access:

- `efortapp@gmail.com`
- `testec202405@gmail.com`

To change that list, update [src/accessControl.js](/Users/polcortes/Documents/EfortCenter/src/accessControl.js).

## Tasks backend setup

1. Create or select the Supabase project for Efort Center.
2. Run [supabase/efort_center_setup.sql](/Users/polcortes/Documents/EfortCenter/supabase/efort_center_setup.sql).

That creates the task tables and seeds the default task owners.

Install Cloud Functions dependencies:

```bash
cd functions
npm install
cd ..
```

Set Firebase Functions secrets:

```bash
firebase functions:secrets:set SUPABASE_URL
firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY
firebase functions:secrets:set TASKS_ADMIN_EMAILS
```

`TASKS_ADMIN_EMAILS` should be a comma-separated allowlist for task management.

## Deploy

Deploy Functions:

```bash
npm run deploy:functions
```

Deploy hosting:

```bash
npm run deploy:hosting
```

`deploy:hosting` forces `VITE_TASKS_BACKEND=firebase` so the mock backend is not shipped to production.

## Analytics notes

- Athlete type response mix reads from `coaches_public.onboarding_athletes_types`.
- The dashboard includes ad-level and ad-set-level Meta export tables.
- The selected date range is controlled by the filters; the dashboard header and table metadata do not repeat it.
- CSV exports match the visible filtered rows.
- The ad table can also export creative assets as a ZIP.
- Meta enrichment fields are resolved from the Ad, Ad Creative, Ad Set, and Campaign payloads.
- `Results` and `Cost / Result` use the internal rules implemented in the dashboard, not Meta's raw values.
- To ship the enriched analytics fields in production, update the deployed callable with [getMetaInsights.patch.js](/Users/polcortes/Documents/EfortCenter/getMetaInsights.patch.js).
- Meta insights backend access is enforced in the deployed function code, not just the dashboard email allowlist. Keep the UID allowlist in sync with [getMetaInsights.patch.js](/Users/polcortes/Documents/EfortCenter/getMetaInsights.patch.js) and the deployed `EfortCoach/functions/analytics/analyticsFunctions.js`.

## Feedback notes

- `/feedback` initially loads the 5 newest documents from the Firebase `feedback` collection with `orderBy("timestamp", "desc")`.
- The `Load more` button fetches the remaining older feedback entries on demand.
- `Copy all` copies CSV to the clipboard with `source`, `text`, `coach_id`, and `timestamp`.
- The page renders the feedback body from `text`, with fallbacks for `feedback`, `message`, and `content`.
- When a feedback document has `source`, the UI prefixes the text as `[SOURCE] ...`.
