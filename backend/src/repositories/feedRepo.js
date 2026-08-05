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
 * Read a page of a user's feed, highest score first.
 *
 * ORDERS BY `score` ALONE, deliberately.
 *
 * The natural query is `orderBy(score desc).orderBy(postedAt desc)` — but two
 * order-by fields require a composite index, and creating one needs a
 * Datastore Index Admin role the deploy service account does not hold. Rather
 * than make the feed depend on a manual console step someone will forget, we
 * order on a single auto-indexed field and break score ties by recency
 * IN MEMORY over the returned page. Ranking is identical for the user, and the
 * system deploys with zero manual setup.
 *
 * Pagination stays correct because Firestore implicitly appends `__name__` to
 * the sort, so `startAfter(score)` is stable across pages even with ties.
 */
export async function listFeed(userId, { limit = 50, cursor = null, minScore = 0 } = {}) {
  // An inequality on the same field we order by also needs no composite index.
  let query =
    minScore > 0
      ? feedRef(userId).where('score', '>=', minScore).orderBy('score', 'desc')
      : feedRef(userId).orderBy('score', 'desc');

  if (cursor) query = query.startAfter(cursor.score);

  const snapshot = await query.limit(limit).get();
  const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  items.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : new Date(b.postedAt) - new Date(a.postedAt)
  );

  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      items.length === limit && last ? { score: last.score, postedAt: last.postedAt } : null,
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

/** Trim the lowest-scoring entries once a feed exceeds MAX_FEED_SIZE. */
export async function trimFeed(userId, maxSize = MAX_FEED_SIZE) {
  const snapshot = await feedRef(userId).orderBy('score', 'desc').offset(maxSize).limit(200).get();
  if (snapshot.empty) return 0;

  const batch = getFirestore().batch();
  for (const doc of snapshot.docs) batch.delete(doc.ref);
  await batch.commit();

  return snapshot.size;
}
