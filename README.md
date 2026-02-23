# Efort Center

Internal analytics dashboard for Efort. Built with React + Vite and secured by Firebase Auth + Firestore rules.

## Setup

1. Copy `.env.example` to `.env` and fill in Firebase web config values. (Vite requires env vars to be prefixed with `VITE_`.)
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run locally:
   ```bash
   npm run dev
   ```

## Firebase

- Firestore collection: `analytics_ads_daily`
- Admin whitelist: `internal_admins/{uid}`

## Build & Deploy

1. Build the app:
   ```bash
   npm run build
   ```
2. Deploy hosting:
   ```bash
   firebase deploy --only hosting --project efort-app
   ```

## Access

Only users with an `internal_admins/{uid}` doc can access the dashboard.

## Athlete Type Response Mix

- Data source: `coaches_public.onboarding_athletes_types`
- Accepted values: `powerlifters`, `bodybuilders`, `other`
- Ratio definition: daily response share (each day is normalized to 100%; multi-select answers are counted separately)
- Missing-data policy: coaches with missing/invalid athlete types are excluded from this chart
- Additional daily counts chart buckets:
  - only `powerlifters`
  - only `bodybuilders`
  - `powerlifters` + `bodybuilders` (without `other`)
  - any selection including `other`
