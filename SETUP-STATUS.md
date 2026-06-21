# Setup status & next steps

_Last updated: 2026-06-21_

## Deployment guide

### A) Mobile app — standalone release APK (no PC/Metro needed)
A signed release APK is built at:
`mobile/android/app/build/outputs/apk/release/app-release.apk`
- Build it anytime:
  ```powershell
  cd "d:\Aj work space\job-alert-system\mobile\android"
  .\gradlew.bat assembleRelease --no-daemon
  ```
- Install on the phone: `adb install -r app\build\outputs\apk\release\app-release.apk`
  (or copy the APK to the phone and tap to install).
- Signing keystore: `mobile/android/app/jobalert-release.keystore`
  (alias `jobalert`, store/key pass `jobalert2026`). **Keep this file safe** —
  you need the SAME keystore to push updates / publish to Play Store. Do not
  commit it publicly. For Play Store, upload this AAB instead:
  `.\gradlew.bat bundleRelease` → `app/build/outputs/bundle/release/app-release.aab`.

### B) Backend — run it 24/7 (so jobs come even when this PC is off)
Pick ONE:
1. **GitHub Actions (free, ~5 min)** — already configured in
   `.github/workflows/cron.yml`. Steps:
   - Push the repo to GitHub.
   - Add repo Secrets (Settings → Secrets → Actions): `FIREBASE_SERVICE_ACCOUNT`
     (the new key JSON, one line), `LINKEDIN_SEARCH_URL`, `LINKEDIN_GEO_IDS`,
     `KEYWORD_FILTER`, `UPWORK_ENABLED=false`.
   - Actions → Job Alert Cron → Run workflow (once) to enable the schedule.
   - Note: 5-min floor (GitHub limitation), not 1-2 min.
2. **Always-on poller (1-2 min)** — needs a machine that stays on:
   - This PC: `cd backend && npm run poll` (or auto-start on boot — ask me).
   - Or a small VPS / always-on box: same command. (Playwright/Chromium needs
     ~1 GB RAM; most free serverless tiers won't run a long-lived browser well.)

Firebase rules + service-account key are already deployed/working.

## Latest round (app v2)
- ✅ **Job links open now.** Removed `Linking.canOpenURL` (it returns false on
  Android 11+ for https) and added `<queries>` to AndroidManifest.
- ✅ **Search bar** added to the job lists (title / company / location).
- ✅ **Location/country filter chips** (built from the data) on each list.
- ✅ **Separate LinkedIn and Upwork tabs** (+ Status tab).
- ✅ **Firebase key replaced** — backend writes to Firestore + sends FCM again
  (verified: 30 LinkedIn jobs saved & pushed to the phone).
- ✅ **Faster polling:** `cd backend && npm run poll` runs the engine every
  ~90s (set `POLL_INTERVAL_SECONDS`). GitHub Actions cron stays at its ~5-min
  floor — see below.
- 🔴 **Upwork still blocked** — see the Upwork section below (Cloudflare).

### Polling: why not 1-2 min on GitHub Actions?
GitHub's scheduler can't reliably run faster than ~5 minutes and throttles under
load; at 1-2 min you'd also blow past the free 2,000 Actions-minutes/month. For
true 1-2 min checking, run the always-on poller on any machine that stays on:
```
cd backend && npm run poll        # default every 90s
# or:  POLL_INTERVAL_SECONDS=120 npm run poll
```

### Upwork is blocked by Cloudflare
- Old RSS feed: **HTTP 410 (gone)**. Search endpoints: **403**. A real headless
  browser (Playwright) hits a **Cloudflare "Enable JavaScript" challenge**.
- Direct scraping is not viable (and against Upwork ToS). Realistic options:
  1. **Official Upwork API** (GraphQL) — requires applying for API access +
     OAuth2. Legit and reliable, but needs Upwork approval.
  2. **Third-party scraper API** (e.g. Apify / RapidAPI Upwork actors) — some
     have free tiers; paid beyond that.
  3. **Leave the Upwork tab as a placeholder** until one of the above.


## ✅ What was fixed / done

### Backend — LinkedIn now works
- **Root cause of "0 jobs from LinkedIn":** the old scraper loaded the
  logged-in `/jobs/search` page but used CSS selectors that only exist on the
  *logged-out* page, so it always found nothing.
- **Fix:** [`backend/src/fetchers/linkedin.js`](backend/src/fetchers/linkedin.js)
  now uses LinkedIn's **public guest jobs endpoint**
  (`/jobs-guest/jobs/api/seeMoreJobPostings/search`). It paginates, sorts by
  newest (`sortBy=DD`), and no longer needs the `li_at` cookie. (The cookie
  actually broke it — it caused `ERR_TOO_MANY_REDIRECTS`.)
- Verified live: fetched 30 real jobs.

### Backend — boolean keyword search
- New module [`backend/src/services/keywordFilter.js`](backend/src/services/keywordFilter.js).
- Supports LinkedIn-style syntax, applied to **both** LinkedIn and Upwork:
  - `AND`  (or just a space between terms)
  - `OR`   (or `/`)
  - `NOT`  (or `-term`)
  - `"quoted phrases"`
  - `( grouping )`
- Configure it with `KEYWORD_FILTER` in `backend/.env` (or the GitHub secret).
  Current value:
  ```
  KEYWORD_FILTER=("react native" OR flutter OR expo OR "react js") NOT senior
  ```
- The LinkedIn search URL also gained `f_TPR=r86400` (only jobs from the last
  24h) so you catch the newest posts. Use `f_TPR=r3600` for the last hour.

### Mobile / React Native dev environment (this PC)
- **JDK 17** (Temurin) installed at `C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot`.
- **Android SDK** installed to **`D:\Android\Sdk`** (NOT the default `C:` —
  your C: drive only had ~2 GB free). Includes: platform-tools (adb),
  platform android-36, build-tools 36.0.0, NDK 27.1.12297006.
- Persisted user environment variables: `JAVA_HOME`, `ANDROID_HOME=D:\Android\Sdk`,
  `GRADLE_USER_HOME=D:\.gradle`, and PATH updated for `adb` + sdkmanager.
- `mobile/android/local.properties` → `sdk.dir=D:/Android/Sdk`.

> ⚠️ **Open a NEW terminal** before running anything below, so the new
> environment variables are loaded.

## ▶️ How to run the app on your phone (wireless ADB)

1. Phone + PC on the **same Wi-Fi**.
2. Phone: **Settings → Developer options → Wireless debugging → ON**.
3. Tap **"Pair device with pairing code"** — note the **IP:port** and **6-digit code**.
4. On PC (new terminal):
   ```powershell
   adb pair 192.168.1.23:<PAIRING_PORT>
   # paste the 6-digit code when asked
   ```
5. Back on the main *Wireless debugging* screen, note the **IP:port** shown
   there (this port is DIFFERENT from the pairing port), then:
   ```powershell
   adb connect 192.168.1.23:<CONNECT_PORT>
   adb devices            # should list your phone
   ```
6. Start the app:
   ```powershell
   cd "d:\Aj work space\job-alert-system\mobile"
   npm start              # Metro bundler (leave running)
   # in a second terminal:
   npm run android
   ```

## 🔴 Still needs YOU (blockers found)

1. **Firebase backend key is dead.** `backend/service-account.json` is rejected
   with `invalid_grant (Invalid JWT Signature)` — the key was revoked/deleted.
   Until you replace it, the backend can fetch jobs but **cannot save them or
   send push notifications**.
   - Fix: Firebase Console → Project Settings → Service Accounts →
     **Generate new private key** → overwrite `backend/service-account.json`.
     Also update the `FIREBASE_SERVICE_ACCOUNT` GitHub secret.

2. **Upwork RSS feed is dead (HTTP 410).** The `UPWORK_RSS_URL` no longer works
   — Upwork retired that public feed. Upwork alerts won't come through until we
   switch to a working method. (Not started yet — you asked to focus on RN.)
