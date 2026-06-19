# Backend Local Setup

## Step 1 — Enable Firestore (Firebase Console)

Agar abhi tak Firestore create nahi kiya:

1. Open [Firebase Console](https://console.firebase.google.com/) → project **job-alert-system-74a27**
2. **Build → Firestore Database → Create database**
3. Choose **Production mode** → pick region (e.g. `asia-south1`)
4. Deploy security rules (Step 4 below)

> Collections **automatically** ban jati hain jab app/backend pehli baar data likhe:
> - `users` — mobile FCM tokens
> - `jobs` — job alerts list
> - `cron_status` — backend run reports

## Step 2 — Download Service Account Key

1. Firebase Console → **Project Settings** (gear icon)
2. **Service accounts** tab
3. **Generate new private key** → download JSON
4. Save as `backend/service-account.json` (gitignored)

## Step 3 — Create `.env`

```bash
cd backend
copy .env.example .env
```

Edit `.env`:
```
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
UPWORK_RSS_URL=your_upwork_rss_url
LINKEDIN_SEARCH_URL=your_linkedin_search_url
LINKEDIN_LI_AT=your_linkedin_cookie
```

## Step 4 — Deploy Firestore Rules

Install Firebase CLI once:
```bash
npm install -g firebase-tools
firebase login
```

From project root:
```bash
cd firebase
firebase use job-alert-system-74a27
firebase deploy --only firestore:rules
```

Or paste rules manually: Firebase Console → Firestore → **Rules** tab → paste `firebase/firestore.rules`

## Step 5 — Run Backend

```bash
cd backend
npm install
npx playwright install chromium
npm start
```

Success output:
```
[Upwork] Parsed N job(s) from RSS feed
[LinkedIn] Scraped N job(s)
[CronReport] Saved run status to Firestore cron_status/latest
```

## Verify in Firebase Console

After mobile app + backend run:
- **Firestore → users** — your device FCM token
- **Firestore → jobs** — fetched jobs
- **Firestore → cron_status → latest** — backend health report

## GitHub Actions (cron)

Same secrets as `.env` but `FIREBASE_SERVICE_ACCOUNT` = entire JSON on **one line** (not file path).
