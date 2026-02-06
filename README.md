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
