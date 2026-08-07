/**
 * Per-user feed repository — `users/{userId}/feed/{jobKey}`.
 *
 * ---------------------------------------------------------------------------
 * THE CENTRAL STORAGE DECISION: fan-out on WRITE, with a documented exit.
 *
 * Firestore cannot answer "jobs where score(job, thisUser) >= 80" — score is
 * not a stored field, it is a function of two documents. Two ways out:
 *
 *   A) Fan-out on READ  — query candidate jobs by tag, score in the API on
 *      every request. Storage O(jobs). Compute O(users x requests).
 *   B) Fan-out on WRITE — score each new job against each user at ingest and
 *      materialise the result. Storage O(users x jobs). Reads are trivial.
 *
 * We chose (B) because it is what makes the product work: the app subscribes
 * to its own feed collection and gets real-time personalised updates with a
 * single cheap listener, and push notifications fall out of the same pass. At
 * this scale (tens of users, ~100-300 fresh jobs/day) the write amplification
 * is a few thousand writes/day — comfortably inside the free tier.
 *
 * The honest limit: at ~10k users x 200 jobs/day that becomes 2M writes/day and
 * (B) stops being viable. The migration is already de-risked — the scorer is
 * pure and `jobsRepo.findByTags()` (the candidate query (A) needs) is already
 * written and tested. Switching is a change to the fan-out module, not a
 * redesign. See ARCHITECTURE.md "Scaling path".
 * ---------------------------------------------------------------------------
 *
 * Feed documents are DENORMALISED — they carry a copy of the job's display
 * fields. The app therefore renders the feed from one collection with zero
 * joins, which on a mobile client is the difference between instant and
 * janky, and it costs one read instead of two per card.
 */

import admin from 'firebase-admin';
import { getFirestore } from '../firebase/admin.js';
import { createLogger } from '../core/logger.js';
import { chunk } from './jobsRepo.js';

const log = createLogger('FeedRepo');
const BATCH_LIMIT = 450;

/** Keep each user's feed bounded — nobody scrolls past a few hundred cards. */
export const MAX_FEED_SIZE = 300;

function feedRef(userId) {
  return getFirestore().collection('users').doc(userId).collection('feed');
}

/**
 * Project a scored job into a feed document.
 * Only fields the card actually renders are copied; the full description stays
 * in `jobs/` so feed docs stay small and listeners stay cheap.
 */
export function buildFeedEntry(job, result) {
  return {
    jobKey: job.jobKey,
    score: result.score,
    matchedSkills: result.matchedSkills,
    reasons: result.reasons,
    breakdown: result.breakdown,

    title: job.title,
    company: job.company,
    location: job.location,
    country: job.country,
    workplace: job.workplace,
    jobType: job.jobType,
    experienceLevel: job.experienceLevel,
    skills: job.skills.slice(0, 12),
    salary: job.salary,
    applyUrl: job.applyUrl,
    postedAt: job.postedAt,

    source: job.sourceId,
    sources: job.seenInSources,

    notified: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Write scored entries into a user's feed.
 * @param {string} userId
 * @param {Array<{job:Object, result:Object}>} scored
 */
export async function writeEntries(userId, scored) {
  if (!scored.length) return 0;
  const db = getFirestore();

  for (const group of chunk(scored, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const { job, result } of group) {
      // merge:true so a rescore updates the score without clobbering
      // `notified` (which would re-notify the user about an old job).
      batch.set(feedRef(userId).doc(job.jobKey), buildFeedEntry(job, result), { merge: true });
    }
    await batch.commit();
  }

  return scored.length;
}

/**
 * Read a page of a user's feed, NEWEST FIRST.
 *
 * Relevance decides what is in this collection; time decides the order. A job
 * is only written here if it cleared the user's threshold, so a chronological
 * order cannot surface anything irrelevant — it just stops a strong two-day-old
 * posting from permanently outranking something that arrived a minute ago.
 *
 * ORDERS BY `postedAt` ALONE, deliberately. Two order-by fields require a
 * composite index, and creating one needs a Datastore Index Admin role the
 * deploy service account does not hold. So we order on a single auto-indexed
 * field and break same-timestamp ties by score IN MEMORY over the returned
 * page — identical result, zero manual setup.
 *
 * `minScore` is likewise applied in memory: as an inequality on a field we do
 * not sort by, it would demand that same unavailable composite index.
 */
export async function listFeed(userId, { limit = 50, cursor = null, minScore = 0 } = {}) {
  let query = feedRef(userId).orderBy('postedAt', 'desc');
  if (cursor?.postedAt) query = query.startAfter(cursor.postedAt);

  // Over-fetch when filtering, so a page still comes back full.
  const fetchLimit = minScore > 0 ? Math.min(200, limit * 3) : limit;
  const snapshot = await query.limit(fetchLimit).get();

  const items = snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item) => (item.score ?? 0) >= minScore)
    .sort((a, b) => {
      const byTime = new Date(b.postedAt) - new Date(a.postedAt);
      return byTime !== 0 ? byTime : b.score - a.score;
    })
    .slice(0, limit);

  // The cursor follows the last document the QUERY returned, not the last one
  // that survived filtering — otherwise a filtered-out tail would be re-read
  // on the next page forever.
  const lastScanned = snapshot.docs[snapshot.docs.length - 1];
  return {
    items,
    nextCursor:
      snapshot.size === fetchLimit && lastScanned
        ? { postedAt: lastScanned.data().postedAt }
        : null,
  };
}

/** Which of these jobKeys are already in the user's feed (so we don't re-notify). */
export async function findExistingKeys(userId, jobKeys) {
  const existing = new Set();
  if (!jobKeys.length) return existing;

  const db = getFirestore();
  for (const group of chunk([...new Set(jobKeys)], 200)) {
    const snapshots = await db.getAll(...group.map((key) => feedRef(userId).doc(key)));
    for (const snapshot of snapshots) if (snapshot.exists) existing.add(snapshot.id);
  }

  return existing;
}

/** Flag entries as notified so a later rescore never re-alerts the same job. */
export async function markNotified(userId, jobKeys) {
  if (!jobKeys.length) return;
  const db = getFirestore();

  for (const group of chunk(jobKeys, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const jobKey of group) {
      batch.set(
        feedRef(userId).doc(jobKey),
        { notified: true, notifiedAt: new Date().toISOString() },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

/**
 * Drop everything from a user's feed. Used when preferences change materially —
 * a stale feed scored against old preferences is worse than a brief empty one,
 * because it silently contradicts what the user just asked for.
 */
export async function clearFeed(userId) {
  const db = getFirestore();
  let deleted = 0;

  // Page through rather than loading the whole subcollection into memory.
  for (;;) {
    const snapshot = await feedRef(userId).limit(BATCH_LIMIT).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    for (const doc of snapshot.docs) batch.delete(doc.ref);
    await batch.commit();

    deleted += snapshot.size;
    if (snapshot.size < BATCH_LIMIT) break;
  }

  if (deleted) log.info('cleared feed', { userId, deleted });
  return deleted;
}

/**
 * Trim the lowest-scoring entries once a feed exceeds MAX_FEED_SIZE.
 *
 * COST WARNING, learned the expensive way: `.offset(n)` does NOT skip cheaply
 * in Firestore — you are billed a document read for every row the offset walks
 * past. `offset(300)` cost 300 reads per user per run, which at a 2-minute
 * cadence was ~1.1M reads/day on its own and exhausted the free tier.
 *
 * Instead: ascending by score (cheapest entries first), read only a small page,
 * and delete the ones that are surplus. `expectedSize` comes from the caller,
 * which already knows how much it just wrote, so the common case does no work
 * and costs nothing.
 */
export async function trimFeed(userId, { maxSize = MAX_FEED_SIZE, expectedSize = null } = {}) {
  // The caller knows the feed cannot be over the cap — skip the query entirely.
  if (expectedSize !== null && expectedSize <= maxSize) return 0;

  const surplus = expectedSize === null ? 50 : Math.min(200, expectedSize - maxSize);
  if (surplus <= 0) return 0;

  const snapshot = await feedRef(userId).orderBy('score', 'asc').limit(surplus).get();
  if (snapshot.empty) return 0;

  const batch = getFirestore().batch();
  for (const doc of snapshot.docs) batch.delete(doc.ref);
  await batch.commit();

  log.debug('trimmed feed', { userId, removed: snapshot.size });
  return snapshot.size;
}

/**
 * How many entries a user's feed holds.
 *
 * Uses an aggregate count() query, which is billed at roughly one read per
 * 1,000 documents counted instead of one per document — the difference between
 * a few reads a day and a few thousand.
 */
export async function countFeed(userId) {
  try {
    const snapshot = await feedRef(userId).count().get();
    return snapshot.data().count ?? 0;
  } catch {
    return null; // aggregate unsupported -> caller falls back to skipping trim
  }
}
