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
- Google sign-in is enabled with Firebase Auth
- Dashboard access is currently controlled in `src/accessControl.js`

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

Only these Google accounts can access the Ad Funnel dashboard:

- `efortapp@gmail.com`
- `testec202405@gmail.com`

To add or remove access, update the email allowlist in [src/accessControl.js](/Users/polcortes/Documents/EfortCenter/src/accessControl.js).

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

## Ad Table Enrichment

- The dashboard now exposes two exportable Meta configuration tables:
  - ad-level table
  - ad set table
- Each table has its own `Export CSV` button and exports the same columns shown in the UI for the current date range and active filters.
- CSV exports exclude the country-inferred fallback rows keyed as `inferred_paid_unknown`, even though those rows remain visible in the dashboard tables.
- The ad table also exposes an `Export Asset Files` action that downloads the available creative image files as a ZIP.
- Asset export now prefers better creative image URLs when Meta exposes them, and falls back to `thumbnail_url` only when no better asset URL is available.
- Asset ZIP filenames are keyed with `Creative ID` and `Ad ID` prefixes to make them easier to map back to exported rows.
- This means the ZIP should be noticeably better than the tiny preview thumbnails, but it is still not guaranteed to contain original full-resolution image/video masters for every ad type.
- The selected date range is also shown on the page and in each table header.
- The Meta enrichment now includes configuration data from:
  - the Ad object
  - the Ad Set object
  - the Campaign object
- Example fields now surfaced in the tables:
  - ad and ad set status
  - ad-level copy fields: primary text/body, headline, description, and CTA
  - campaign name, objective, and buying type
  - creative thumbnail, creative ID, and creative name
  - URL tags, post ID, and preview link when available
  - optimization goal and optimization event
  - billing event, bid strategy, and daily budget
  - attribution spec
  - publisher platforms, positions, device platforms, and countries
  - ad set start and end time
  - outbound clicks, unique outbound clicks, frequency, CPM, optimization results, and cost per result
- The ad and ad set tables also include athlete-type share columns based on `coaches_public.onboarding_athletes_types`:
  - `% Powerlifter`
  - `% Bodybuilder`
  - `% Other`
- These percentages are calculated as the share of coaches in the row whose `onboarding_athletes_types` includes that value at least once. Because coaches can select multiple values, the three percentages can sum to more than 100%.
- Meta delivery metrics still come from the insights endpoint, but the extra metadata is resolved with follow-up reads on the Ad, Ad Creative, Ad Set, and Campaign objects.
- The dashboard reuses a browser-side Meta cache in `localStorage` for the active date range to reduce repeated callable requests.
- Optimization event resolution is best-effort:
  - standard events such as `CompleteRegistration` come from `promoted_object.custom_event_type`
  - custom conversion names are shown when Meta exposes a `custom_conversion_id` that can be resolved
  - otherwise the table falls back to the ad set `optimization_goal`
- The tables intentionally label source-sensitive fields explicitly:
  - `Signups (coaches_public)` are internal signup counts from Firestore
  - `Results` and `Cost / Result` are internal metrics derived from `coaches_public` plus the ad set optimization event
  - `Preview Link` is the Meta preview/share link when available, not a guaranteed public post permalink
- `Results` now follow an internal rule:
  - only coaches with `cookies_accepted === true` are eligible to count toward `Results`
  - if `Optimization Event` is `COMPLETE_REGISTRATION`, `Results = cookie-accepted signups`
  - if `Optimization Event` is `OTHER`, `Results = cookie-accepted coaches in that row with `powerlifters` selected in `onboarding_athletes_types`
  - otherwise `Results` stays `-`
- `Cost / Result` is `spend / results` when the row has Meta spend data and `Results > 0`; otherwise it stays `-`
- Ad set `Results` and `Cost / Result` are rolled up from the visible child ad rows so ad rows and ad set rows stay consistent.
- Post ID and preview-link fields are best-effort and depend on the creative type and which destination fields Meta exposes for that ad.
- Ad copy fields are also best-effort and ad-level only. They are resolved from the creative payload Meta exposes, with fallbacks across `object_story_spec`, top-level creative fields, and dynamic creative `asset_feed_spec` when available.
- The `date_start` and `date_stop` values from insights are reporting dates, not ad schedule dates. The active window shown in the table is sourced from the ad set schedule instead.
- To populate these new columns in production, update the deployed Firebase callable using [getMetaInsights.patch.js](/Users/polcortes/Documents/EfortCenter/getMetaInsights.patch.js).
