# Backend — Job Alert Engine

Node.js cron script that fetches jobs from Upwork and LinkedIn, deduplicates via Firestore, and sends FCM push notifications.

## Quick Start

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env
npm start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT` | Yes | Service account JSON (single-line string) |
| `UPWORK_RSS_URL` | Yes | Upwork RSS feed URL |
| `LINKEDIN_SEARCH_URL` | Yes | LinkedIn job search URL |
| `LINKEDIN_LI_AT` | Yes | LinkedIn `li_at` session cookie |
| `KEYWORD_FILTER` | No | Lowercase keyword to filter results |
| `MAX_JOBS_PER_RUN` | No | Max jobs to process per run (default: 50) |

## Architecture

```
index.js
  ├── loadConfig()
  ├── initFirebase()
  ├── fetchUpworkJobs()     → rss-parser
  ├── fetchLinkedInJobs()   → playwright + cookie injection
  └── processJobs()
        ├── jobExists()     → skip duplicates
        ├── getActiveDeviceTokens()
        ├── sendJobAlert()  → FCM multicast
        └── saveJob()
```

## GitHub Actions

The workflow at `.github/workflows/cron.yml` runs this script every 15 minutes. All secrets are injected at runtime — nothing sensitive is stored in the repo.
