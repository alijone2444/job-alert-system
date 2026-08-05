# Job Alert System

A free, multi-source job discovery stack that gives **every user a different
feed**. It continuously collects fresh postings from six job boards, normalises
and deduplicates them, scores each one against each user's own preferences, and
pushes only strong matches to a React Native app.

> **Design rationale, trade-offs and the scaling path live in
> [ARCHITECTURE.md](ARCHITECTURE.md).** Read that before changing anything
> structural — several decisions here look arbitrary until you know what broke
> without them.

| Layer | Tech | Hosting |
|---|---|---|
| Ingestion + recommendation | Node.js (ESM), cheerio, firebase-admin | Vercel serverless |
| Trigger | cron-job.org → `GET /api/run` every 2 min | free |
| Database | Firestore | Firebase (Spark) |
| Push | Firebase Cloud Messaging | Firebase |
| Mobile | React Native 0.86 + TypeScript | Android device |

---

## How it works

```
cron (2 min) ─► /api/run ─► ingest ─► normalize ─► dedupe ─► enrich ─► jobs/
                                                                        │
                                            score(job, prefs) per user ─┤
                                                                        ▼
                                    users/{id}/feed  +  targeted FCM push
                                                │
                                    React Native app (live listener)
```

**Ingestion knows nothing about any user.** It casts a wide net. The
recommendation engine — a pure `scoreJob(job, prefs) → 0-100` function — decides
relevance per person. That separation is what makes N users possible.

---

## Sources

| Source | Status |
|---|---|
| LinkedIn | live — public guest endpoints, no login or browser |
| Greenhouse | live — free public API |
| Lever | live — free public API |
| Ashby | live — free public API, includes structured salary |
| RemoteOK | live — free public API |
| We Work Remotely | live — public RSS |
| Rozee.pk | implemented, needs `SCRAPER_PROXY_URL` (Cloudflare-blocked) |
| Indeed / Wellfound | **not possible** without a commercial data partner |

Adding a board is **one file + one line** — see
[`backend/src/sources/Source.js`](backend/src/sources/Source.js).
Adding a *company* is one line in
[`backend/src/sources/companyBoards.js`](backend/src/sources/companyBoards.js).

---

## Repository structure

```
backend/
  api/                  Vercel HTTP handlers (one file per endpoint)
  src/
    core/               taxonomy, NormalizedJob, preferences, http, logger, text
    sources/            one adapter per job board + the registry
    pipeline/           ingest orchestration, deduplication
    reco/               scorer, tunable weights, per-user fan-out
    repositories/       Firestore access (jobs, users, feed, interactions, settings)
    services/           push notifications, run reporting
    http/apiKit.js      shared handler wrapper (bootstrap, auth, CORS, errors)
    engine.js           one full cycle
    poll.js             always-on local alternative to the cloud cron
  scripts/
    deploy-firebase.mjs publishes rules + indexes without firebase-tools

mobile/src/
  api/                  typed REST client
  domain/               bundled taxonomy mirror
  theme/                design tokens
  services/ hooks/      data layer
  components/ screens/  UI
  navigation/           4-tab bottom navigator

firebase/
  firestore.rules       who may write what
  firestore.indexes.json
```

---

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/run?key=…` | One full cycle — the cron's URL |
| `GET /api/health` | Liveness + last run (open) |
| `GET /api/taxonomy` | Option lists for the Personalize screen (open) |
| `POST /api/register` | Device + FCM token |
| `GET/POST /api/preferences` | Read / update; POST also rebuilds the feed |
| `GET /api/feed` | Paginated personalised feed |
| `POST /api/interactions` | save / unsave / hide / unhide / apply |
| `POST /api/rescore` | Force a feed rebuild |
| `GET /api/sources` | Registry + health, incl. unavailable boards |

Apply **always opens the original posting**. The system never replicates or
proxies an application flow.

---

## Running it

```bash
# One cycle locally (writes to the real Firestore)
cd backend && npm install && npm start

# Continuous local polling — a home IP is more reliable for LinkedIn than
# datacenter IPs, which get rate-limited harder
cd backend && npm run poll

# Publish Firestore rules + indexes
cd backend && npm run deploy:firebase

# Android release build
cd mobile && npm install
cd android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

### Configuration

Only `FIREBASE_SERVICE_ACCOUNT` (or `FIREBASE_SERVICE_ACCOUNT_PATH`) is
required. Everything else has a working default — see
[`backend/.env`](backend/.env) for the full list. Behaviour is tunable **without
a redeploy** through Firestore: `settings/scoring` for weights,
`settings/ingest` for the freshness window, per-source caps and the run budget.

### Secrets

Never commit the Firebase service-account key — a key in a public repo gets
auto-revoked by Google. It lives in a gitignored local file for development and
in the `FIREBASE_SERVICE_ACCOUNT` environment variable on Vercel / GitHub.

---

## Notes

- The release APK has JS **bundled**. `adb force-stop/start` will not pick up a
  JS change (that is Metro/debug only) — rebuild and reinstall.
- The GitHub Actions schedule is intentionally disabled; the Vercel cron is
  faster and a 5-minute Actions schedule would exhaust a private repo's free
  Actions quota in about four days. Manual runs still work from the Actions tab.
