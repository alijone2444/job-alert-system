# Architecture

How this system turns "one global feed" into "a different feed for every user",
and why each piece is built the way it is.

---

## 1. The shape of the system

```
 cron-job.org  ──every 2 min──►  GET /api/run  (Vercel serverless)
                                      │
        ┌─────────────────────────────┴──────────────────────────────┐
        │                        THE ENGINE                          │
        │                                                            │
        │  1. INGEST                                                 │
        │     LinkedIn ─┐                                            │
        │     Greenhouse│                                            │
        │     Lever     ├─► normalize ─► dedupe ─► enrich ─► store   │
        │     Ashby     │   (one schema) (3 layers) (detail) (jobs/) │
        │     RemoteOK  │                                            │
        │     WWR      ─┘                                            │
        │                                                            │
        │  2. FAN-OUT                                                │
        │     for each user:                                         │
        │       score(job, prefs) ─► 0-100 ─► above threshold?       │
        │         └─► users/{id}/feed/{jobKey}                       │
        │         └─► targeted FCM push (above notify threshold)     │
        │                                                            │
        │  3. MAINTENANCE                                            │
        │     retention prune, per-source health, run report         │
        └────────────────────────────────────────────────────────────┘
                                      │
                    Firestore ◄───────┴───────► React Native app
                (live listeners on users/{id}/feed)
```

**What did NOT change:** the cron URL, its `?key=` auth, the `runEngine()`
contract, and `api/run.js`'s response shape. The existing cron-job.org schedule
kept working across this rewrite with zero reconfiguration.

**What changed:** everything behind that endpoint.

---

## 2. The decision that drove the whole redesign

The old system encoded **one person's job preferences into the ingestion layer** —
a hard-coded LinkedIn search URL and a boolean `KEYWORD_FILTER`. Every user
therefore got the same feed, and personalising for a second user was impossible
without breaking the first.

The fix is a strict separation:

| Layer | Job | Must NOT do |
|---|---|---|
| **Ingestion** | Collect broadly. Cast a wide net across every source. | Know anything about any individual user |
| **Recommendation** | Decide relevance per user | Fetch anything |
| **Delivery** | Materialise and push | Re-rank |

Ingestion now uses a deliberately broad discovery query. Narrowing is the
recommender's job. That one boundary is what makes N users possible.

---

## 3. Source adapters

### The contract (`src/sources/Source.js`)

Adding a board must require writing **one file** and adding **one line** to the
registry — never touching the pipeline, the scorer, the API or the app.

```js
defineSource({
  id, label, homepage,
  available, unavailableReason,
  capabilities: { description, salary, jobType, workplace, level, countryQuery },
  fetchJobs(ctx),      // -> NormalizedJob[]
  enrich(jobs, ctx),   // optional second pass
});
```

### What is actually live (every one probed before implementing)

| Source | Status | How |
|---|---|---|
| LinkedIn | live | Public guest endpoints, no login/cookie/browser |
| Greenhouse | live | `boards-api.greenhouse.io` — free, key-less |
| Lever | live | `api.lever.co/v0/postings` — free, key-less |
| Ashby | live | `api.ashbyhq.com/posting-api` — free, and the only source with **structured salary** |
| RemoteOK | live | `remoteok.com/api` — free (attribution required by their ToS, honoured in the app) |
| We Work Remotely | live | Public RSS |
| Rozee.pk | **implemented, off** | Cloudflare-blocked (HTTP 403 from datacenter IPs). Parser is written; set `SCRAPER_PROXY_URL` to enable |
| Indeed | **not possible** | No public API for new publishers; scraping is Cloudflare-blocked and ToS-prohibited. Needs a commercial data partner |
| Wellfound | **not possible** | Cloudflare-protected + login-gated (HTTP 403) |

"Company career pages" is implemented as Greenhouse + Lever + Ashby: there is no
generic way to scrape an arbitrary careers page, but the overwhelming majority of
tech companies host theirs on one of these three. Adding a company is a one-line
change in `src/sources/companyBoards.js` — every default slug there was verified
live to resolve *and* have postings in the last 7 days.

Unavailable sources are still declared in the registry and surfaced by
`GET /api/sources` with their reason, so the Status screen shows the honest
answer instead of an unexplained absence.

### LinkedIn's two endpoints, and why enrichment is separate

A LinkedIn **search card** carries only title / company / location / date — no
employment type, seniority, description or skills. Almost nothing the
recommender can score on.

The **detail endpoint** (`/jobs-guest/jobs/api/jobPosting/<id>`) returns the full
description plus a Seniority / Employment type / Job function block. That is what
makes real personalisation possible on the largest source.

But detail is **one request per job**. Fetching it for ~100 search results every
2 minutes is ~72,000 requests/day and a 429 within the hour. So the pipeline
dedupes *first* and enriches only genuinely-new jobs, under a per-run budget.
Typical cost: 0–12 detail requests per run.

---

## 4. Normalization

`src/core/taxonomy.js` is the single source of truth for every enum. Sources
disagree about everything — LinkedIn says `"Mid-Senior level"`, Ashby says
`"FullTime"`, RemoteOK says `full_time`. Each adapter maps its raw values into
canonical ids, and the scorer only ever compares canonical ids.

`src/core/normalizedJob.js` is the **only** module allowed to construct a job
document. Unknown values are explicitly `null`, never `undefined`.

> **`null` means UNKNOWN, not "no".** The scorer treats unknown as neutral, so a
> source with thin metadata never drags a good job below the threshold.

### Detection is word-boundary based, and that is not a detail

The first version used `String.includes()`. Live testing caught it labelling an
*Assistant General Counsel* role as an **internship** (`"intern"` inside
`"internal"`) and as **lead** level (`"lead"` inside `"leading"`). A mislabelled
job is worse than an unlabelled one, because "unknown" is scored neutrally while
a wrong label is scored *confidently*.

Salary extraction is deliberately conservative for the same reason — a bogus
figure below the user's minimum actively buries a good job. Three guards: the
number must look monetary (comma-grouped, `k`/`m` suffix, or 4+ digits), must
fall inside a plausible band for its period, and the currency token must sit
beside the number. The naive version was reading `"$124"` out of a legal
paragraph and filing it as a monthly wage.

---

## 5. Deduplication

The same job genuinely appears on several boards. Three layers, cheapest first:

1. **Exact key** — `sha1(titleNorm | companyNorm | country)`, used as the
   Firestore **document id**, so cross-*run* dedupe is free: a re-fetched job
   simply resolves to an existing document.
2. **URL identity** — canonicalised apply URL (host + path, tracking params
   stripped).
3. **Near-duplicate** — token-overlap (Jaccard ≥ 0.82) within the same company
   and country. Catches "React Native Engineer" vs "Engineer, React Native",
   which an exact hash misses. Bucketing by company keeps this linear in
   practice rather than O(n²).

Duplicates are **merged, not discarded**: LinkedIn may be the only source that
knows the seniority while Ashby is the only one with the salary. Discarding
either would make the result worse than the sum of its inputs. The earliest
`postedAt` wins — that is when the job actually went live.

*Measured: ~15–30 duplicates collapsed out of ~50 fetched per run.*

---

## 6. The recommendation engine

### `scoreJob(job, prefs, config)` is a pure function

Same inputs → same output. No I/O, no clock reads other than the one passed in.
This is the most important architectural constraint in the codebase:

- It runs at **ingest** time (fan-out-on-write, today) or at **query** time
  (fan-out-on-read, the scaling path) without a line changing. Storage strategy
  becomes swappable.
- It is testable without Firebase.
- It can be ported to the client verbatim for offline re-ranking.

### Coverage-weighted, not fixed-denominator

The naive approach — sum every dimension out of a fixed total — fails in both
directions:

- A user who only set skills gets punished on six dimensions they never had an
  opinion about. Nothing ever reaches 80%.
- A LinkedIn job with no published salary scores 0 on salary, so the richest
  source of *fresh* jobs is systematically ranked last.

So each dimension resolves to one of three states:

| State | When | Effect |
|---|---|---|
| `NOT_APPLICABLE` | User expressed no preference | Removed from the denominator. Costs the job nothing. |
| `UNKNOWN` | User cares, job has no data | Neutral credit at reduced weight. Lowers confidence, never fatal. |
| `SCORED` | Both sides have data | Real 0–1 credit at full weight. |

```
score = 100 × Σ(weight × credit) / Σ(weight)   over applicable dimensions
        + bonuses (freshness, preferred company, multi-source)
```

**This is what makes a genuine 80–90% threshold usable instead of
aspirational.**

### Default weights (`src/reco/weights.js`, runtime-overridable)

| Dimension | Weight | Notes |
|---|---|---|
| Skills | 34 | Full credit at 3 matches — a user selecting 10 skills is describing a profile, not a checklist |
| Country | 18 | Worldwide-remote 0.85, remote-elsewhere 0.6 |
| Experience level | 12 | **Distance-based**, not equality — mid→senior is a near-miss worth showing; mid→lead is not |
| Workplace | 12 | |
| Job type | 10 | |
| Keywords | 8 | |
| Salary | 6 | Missing salary is never penalised |

### One subtlety worth calling out

"No skills detected" splits into two very different cases, and conflating them
was a real bug found in testing — a *Senior Compliance Analyst* scored **85%**
for a MERN developer, purely because it was senior, remote and in-country, while
its total absence of tech skills was scored as neutral "unknown".

- We **have** read the body and found none of ~50 canonical tech skills → that is
  *evidence*, not ignorance. Score it low (0.2) at full weight.
- We **have not** read the body yet (a LinkedIn card awaiting enrichment) →
  genuinely unknown. Stay neutral; the next run enriches it.

### Hard filters

Blocked companies and excluded keywords are absolute vetoes — no amount of skill
overlap overrides them. Applied *before* scoring, so no work is wasted on a job
that can never be shown.

### Explainability

Every score carries a `breakdown` and human `reasons` ("Matches 3 of your
skills", "Remote role", "Fresh posting"), rendered on the card. A user who
cannot see *why* a job matched will not trust the percentage.

### Thresholds

| | Default | Why |
|---|---|---|
| Feed | 70 | Below the 80–90 target band on purpose — a new user with broad preferences would otherwise open an empty app |
| Notify | 82 | Push interrupts, so the bar is higher |

Both are per-user sliders in the Personalize tab. A user with **no** preferences
at all bypasses the threshold entirely and gets a chronological feed — an empty
first run is the worst possible first impression.

---

## 7. Storage: fan-out on write

Firestore cannot answer *"jobs where score(job, thisUser) ≥ 80"* — score is a
function of two documents, not a stored field. Two ways out:

| | Storage | Compute | Reads |
|---|---|---|---|
| **(A) Fan-out on READ** | O(jobs) | O(users × requests) | Score on every request |
| **(B) Fan-out on WRITE** | O(users × jobs) | O(users × new jobs) | Trivial |

**We chose (B)**, because it is what makes the product work: the app subscribes
to its own feed collection and gets real-time personalised updates from a single
cheap listener, and push notifications fall out of the same pass. At this scale
(tens of users, ~100–300 fresh jobs/day) write amplification is a few thousand
writes/day — comfortably inside the free tier.

**The honest limit:** at ~10k users × 200 jobs/day that becomes 2M writes/day and
(B) stops being viable.

### The migration is already de-risked

- The scorer is **pure**, so it can move to query time unchanged.
- Every job already carries a flat `tags[]` array (`skill:react`, `country:PK`,
  `level:senior`, …) — the inverted index that fan-out-on-read needs.
- `jobsRepo.findByTags()` — the candidate query — is already written.
- Feed documents are **denormalised** (they carry the job's display fields), so
  the app renders with zero joins either way.

Switching is a change to `src/reco/fanout.js`, not a redesign. Beyond that,
the path is Postgres + a worker queue, where the repository layer
(`src/repositories/`) is the only thing that gets rewritten — which is precisely
why it exists.

---

## 8. Firestore schema

```
jobs/{jobKey}                          # shared, deduplicated pool
  jobKey, sourceId, sourceJobId, seenInSources[]
  title, titleNorm, company, companyNorm, location, country
  workplace, jobType, experienceLevel, skills[]
  salary{min,max,currency,period}, salaryAnnualUsd
  description, applyUrl, postedAt, ingestedAt, enriched
  tags[]                               # inverted index for the scaling path
  quality{score, flags[]}

users/{userId}                         # userId == deviceId (no auth yet)
  fcmToken, platform, appVersion
  prefsVersion, lastScoredPrefsVersion # drives "rebuild this user's feed"
  lastSeenAt

users/{userId}/settings/preferences
  countries[], skills[], jobTypes[], workplaces[], levels[]
  salary{min,max,currency}
  preferredCompanies[], blockedCompanies[]
  keywordsInclude[], keywordsExclude[]
  strictCountry, feedThreshold, notifyThreshold, notificationsEnabled
  version, updatedAt

users/{userId}/feed/{jobKey}           # materialised, denormalised
  score, breakdown{}, matchedSkills[], reasons[]
  title, company, location, workplace, jobType, salary, applyUrl, postedAt
  source, sources[], notified, createdAt

users/{userId}/interactions/{jobKey}
  state: saved|hidden|none, appliedAt, snapshot{}, updatedAt

sources/{sourceId}                     # per-board health
cron_status/latest                     # last run report
settings/scoring, settings/ingest      # runtime tuning, no redeploy needed
```

Preferences live in a **subcollection** rather than on the user document because
the user doc is read on every cron run (for FCM tokens) while preferences are
only read when scoring. Splitting keeps the hot read small.

Interactions are **one collection with a `state` field**, not three collections:
a job is in exactly one state at a time (saving a hidden job should un-hide it),
and one document per job makes that invariant impossible to violate.

### No composite indexes required

Every query uses a single order-by field, or an inequality on that same field, so
Firestore's automatic single-field indexes cover it. Where the natural query
wanted two order-by fields (feed pagination, saved list), the second sort is done
**in memory over the returned page** — identical result for the user, and the
project deploys with no manual console step. `firebase/firestore.indexes.json`
lists optional indexes needed only by the fan-out-on-read path.

### Security rules

There is no authentication yet, so rules cannot verify identity. What they *do*
enforce is **who may write**:

- `users/{id}/feed` — **read-only**. A client able to write match scores could
  put anything at the top of its own feed.
- `users/{id}/interactions` — **read-only**; writes go through the API so state
  transitions stay consistent.
- `jobs`, `sources`, `cron_status`, `settings` — **read-only**.
- `users/{id}` and `users/{id}/settings` — writable, so token registration and
  the settings screen degrade gracefully when the API is unreachable.

The backend uses the Admin SDK, which bypasses rules entirely.

---

## 9. API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/run` | GET | One full cycle. **Unchanged** — the cron's existing URL |
| `/api/health` | GET | Liveness + last run (unauthenticated, for uptime monitors) |
| `/api/register` | POST | Device + FCM token registration |
| `/api/taxonomy` | GET | Option lists for Personalize (unauthenticated) |
| `/api/preferences` | GET/POST | Read / update; a POST also **rebuilds the feed synchronously** |
| `/api/feed` | GET | Paginated, filtered feed |
| `/api/interactions` | POST | `save` / `unsave` / `hide` / `unhide` / `apply` |
| `/api/rescore` | POST | Force a feed rebuild (pull-to-refresh) |
| `/api/sources` | GET | Registry + health, including unavailable boards |

**Reads live, writes REST.** The app subscribes to Firestore for the feed —
real-time updates and offline caching for free, which is exactly what a feed
needs — while writes go through HTTP, where the server can validate and rescore.
That is logic a client cannot be trusted to skip.

`/api/preferences` rebuilds **synchronously** because the user is standing in the
Personalize screen. Making them wait up to two minutes for the next cron tick is
the difference between a settings screen that feels alive and one that feels
broken.

`/api/interactions` is one endpoint with an `action`, not three routes, for the
same reason the interactions collection is one document per job.

**`apply` never submits an application.** It records that the user opened the
posting; the app then opens `applyUrl` — LinkedIn jobs open LinkedIn, Greenhouse
jobs open that company's board. We never replicate, proxy or intermediate
anybody's application flow.

---

## 10. Time budgets, and why there are three

Vercel kills a function at its timeout with **no chance to persist anything**, so
an overrun loses the entire run *and* makes the cron look dead.

A single shared budget was tried first and failed twice, both times **silently**:

1. Fetching consumed everything → fan-out was skipped → 43 jobs stored, **no
   user's feed built**. Fetching jobs nobody is shown is worse than useless: it
   burns the source's rate limit for nothing.
2. Then enrichment was skipped → LinkedIn jobs never gained the skills data the
   scorer needs → personalisation was silently crippled on the largest source.

Both runs reported `status: success`.

So each stage gets a guaranteed slice, ordered by how much the **product**
depends on it:

| Stage | Share | Rationale |
|---|---|---|
| Fetch | 45% | The only stage safe to cut short — sources rotate, the next run (2 min later) picks up what was skipped |
| Enrich | 18% | What makes personalisation accurate |
| Fan-out | remainder, **min 12s floor** | This *is* the product |

A subtle trap worth recording: **a budget is a stopwatch, so it must be started
when its stage starts.** An "8s enrichment budget" created at the top of the run
was already expired by the time enrichment began, and `enriched` sat at 0
forever.

---

## 10b. The read budget — the constraint that shaped fan-out

Firestore's free tier allows **50,000 document reads per day**. This system runs
**720 times a day**. That is a budget of roughly **70 reads per run for the
entire product**, and it is a hard architectural constraint, not a footnote.

The first version blew through it by a factor of 26 and exhausted the daily
quota in a few hours. Where it went:

| Cost | Per run | Why |
|---|---|---|
| `trimFeed` using `.offset(300)` | **~1,500** | Firestore **bills every document an offset walks past**. It is not a cheap skip. |
| `findExistingKeys` per user | ~250 | Checking whether each match was already in a feed |
| Users + preferences read twice | ~10 | The engine loaded them, then fan-out loaded them again |
| `findExisting` over a 24h window | ~60 | A 24-hour lookback re-fetched the same day of jobs 720 times |
| Retention prune at 7% of runs | ~20 avg | Housekeeping nobody is waiting for |
| **Total** | **~1,900** | **≈1.3M reads/day** |

The fixes, in order of what they taught:

1. **`.offset()` is not free.** Replaced with an ascending-by-score page sized
   from a count the caller already has.
2. **A globally-new job cannot be in anybody's feed.** It has never been scored.
   The membership check was asking a question we could already answer, at ~250
   reads a run.
3. **Pass state down, don't re-read it.** Users and preferences are loaded once
   by the engine and handed to fan-out.
4. **A quiet run must cost zero.** No new jobs and nobody needing a rebuild now
   returns before touching Firestore. Most runs are quiet runs.
5. **The lookback window is a catch-up window, not a filter.** Cut from 24h to
   3h: stored jobs live 30 days regardless, so the only thing 24h bought was
   tolerating a full day of downtime — at 720× the redundant work.

Now ~30 reads per run, ~22,000/day, comfortably inside the free tier.

**If you raise the cadence or add users, redo this arithmetic first.** The
formula is `reads_per_run × 720 ≤ 50,000`. Beyond it, the options are the Blaze
plan (reads past the free allowance are ~$0.06 per 100,000 — cents per month at
this scale) or a longer cron interval.

---

## 11. Notifications

Previously: multicast every job to every device — the exact thing
personalisation exists to stop.

Now, per user:

- Only jobs above **that user's own** `notifyThreshold`.
- Only jobs not already in their feed (checked *before* writing, because writing
  is what makes them look old).
- At most **3** individual alerts per cycle; beyond that, one summary. Ten alerts
  at once do not get read — they get the app muted.
- A feed rebuild after a preference change sends **nothing**. Buzzing someone's
  phone 40 times because they ticked "Remote" would be indefensible.
- Dead tokens are detected from FCM error codes and cleared.

---

## 12. Mobile app

```
mobile/src/
  api/client.ts          typed REST client (timeout, retry, typed errors)
  config/env.ts          API base URL + app key
  domain/taxonomy.ts     bundled mirror of the backend taxonomy
  theme/                 design tokens — no raw hex in any screen
  types/                 shared domain types
  services/              feed, preferences, interactions, device, notifications
  hooks/                 useFeed, usePreferences, useBackendStatus
  components/            JobCard, Chip, MultiSelect, TagInput, SectionCard, …
  screens/               Feed, Saved, Personalize, Status
  navigation/            4-tab bottom navigator
```

**Four tabs: For you · Saved · Personalize · Status.**

Personalization gets its **own tab** rather than a settings sheet over the feed —
the feed screen stays free of configuration chrome, and personalisation is
somewhere a user genuinely returns to and refines, not a one-time step buried
behind a gear icon.

Design decisions worth recording:

- **The feed has no sort control.** Offering "sort by date" would let the user
  undo the personalisation that is the point of the product. It offers
  *narrowing* instead: search, source, minimum match.
- **The taxonomy is fetched but also bundled.** The screen renders instantly and
  works offline from the bundled copy, then swaps in the server's list — so a
  skill added on the backend reaches every device with no APK update.
- **Preferences use a local draft with a sticky save bar.** Every save triggers a
  server-side rebuild; auto-saving on each chip tap would fire dozens of rebuilds
  while the user is still deciding.
- **Saved renders from a stored snapshot**, not from the shared `jobs`
  collection. Jobs are pruned after 30 days, and a saved job vanishing because of
  a retention job the user never heard of would be a bug they could not explain.
- **Saved hides match scores.** The score was computed against the preferences in
  force when the job was saved; showing it later presents a stale number as a
  current one.
- **Foreground pushes are silent.** The feed listener already inserts the card
  live — a popup would interrupt the user about something already on screen.

---

## 13. Known limits

1. **No authentication.** A "user" is a device id. Reinstalling the app loses
   preferences. Every API takes `userId` as an opaque string, so adding Firebase
   Auth means verifying a token in `src/http/apiKit.js#authorize` and deriving
   `userId` from it — nothing else changes.
2. **Shared app key, not a user credential.** `APP_API_KEY` stops casual abuse of
   the public endpoints, nothing more.
3. **Fan-out-on-write ceiling ~10k users** (see §7).
4. **Salary coverage is ~15%.** Most boards do not publish pay. The scorer is
   built so this costs nothing.
5. **Indeed, Wellfound and Rozee need a commercial scraping proxy.** Adapters and
   registry entries exist; only the network call is blocked.
6. **No feedback loop yet.** `applied` and `hidden` are recorded but not fed back
   into ranking. That is the obvious next step: down-weight sources/companies a
   user repeatedly hides, up-weight what they apply to.

---

## 14. Operations

```bash
# One run locally (writes to the real Firestore)
cd backend && npm start

# Continuous local polling (home IP is more reliable for LinkedIn than
# datacenter IPs, which get rate-limited more aggressively)
cd backend && npm run poll

# Publish Firestore rules + indexes (no firebase-tools needed)
cd backend && node scripts/deploy-firebase.mjs

# Release APK
cd mobile/android && ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

Tuning without a redeploy:

- `settings/scoring` in Firestore — weights and tuning constants
- `settings/ingest` — freshness window, per-source caps, run budget
- `DISABLED_SOURCES` env — kill switch for a misbehaving board
- `GREENHOUSE_BOARDS` / `LEVER_BOARDS` / `ASHBY_BOARDS` env — which companies to poll

> The release APK has JS **bundled**. `adb force-stop/start` does not reload new
> JS (that is Metro/debug only) — any JS change needs `assembleRelease` and a
> reinstall.
