# Deploy on Vercel (free) + external cron = frequent 24/7 alerts

The LinkedIn fetch now uses plain `fetch` + cheerio (no Chromium), so it runs as
a tiny Vercel serverless function. A free external cron pings it every 1–2 min.
No PC, no card, no VM.

## 1. Import the repo into Vercel
1. https://vercel.com → sign up (GitHub login, free, no card).
2. **Add New → Project → Import** `alijone2444/job-alert-system`.
3. **Root Directory: `backend`** (important — set this so it deploys the backend).
4. Framework preset: **Other**. Build command: leave empty. Deploy.

## 2. Environment Variables (Vercel → Project → Settings → Environment Variables)
Add these (Production):
- `FIREBASE_SERVICE_ACCOUNT` = the service-account JSON as ONE line.
  Get it: `(Get-Content backend/service-account.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress) | Set-Clipboard`
- `LINKEDIN_SEARCH_URL` = your keyword search URL (same as backend/.env).
- `KEYWORD_FILTER` = the dev-role filter (same as backend/.env).
- `UPWORK_ENABLED` = `false`
- `RUN_SECRET` = any random string (e.g. `pk-jobs-9f3a`), so only you can trigger it.

Redeploy after adding env vars (Deployments → ⋯ → Redeploy).

## 3. Test the endpoint
Open in browser:
`https://<your-app>.vercel.app/api/run?key=<RUN_SECRET>`
You should get `{"ok":true,...}` and new jobs get saved/notified.

## 4. Free external cron (every 1–2 min)
1. https://cron-job.org → sign up (free, no card).
2. **Create cronjob**:
   - URL: `https://<your-app>.vercel.app/api/run?key=<RUN_SECRET>`
   - Schedule: every **1 or 2 minutes**.
   - Save + enable.

Done — now it checks LinkedIn every 1–2 min, 24/7, free. New jobs → push to phone.

## Notes
- Country/time/sort are still controlled from the phone app (Firestore
  `settings/filters`); the Vercel function reads them each run. Default Pakistan.
- Vercel is a datacenter IP, so LinkedIn may occasionally return 0 jobs on a
  hit — the next hit (1–2 min later) usually succeeds.
- Keep the GitHub Actions cron as a backup, or disable it.
