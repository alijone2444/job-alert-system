/**
 * Jobs repository — the ONLY module that reads/writes the `jobs` collection.
 *
 * WHY a repository layer at all: the pipeline, the API and the fan-out all need
 * jobs, and all three would otherwise hand-roll Firestore queries. Centralising
 * means the eventual migration off Firestore (documented in ARCHITECTURE.md) is
 * a rewrite of THIS file, not a rewrite of the system.
 *
 * Firestore specifics that shaped this file:
 *   - Document id IS the jobKey, so cross-run dedupe is free.
 *   - Batched writes cap at 500 ops; `chunk()` enforces that.
 *   - `getAll()` fetches many docs in one round trip — far cheaper than N gets
 *     when checking which of ~150 fetched jobs we already have.
 */

import admin from 'firebase-admin';
import { getFirestore } from '../firebase/admin.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('JobsRepo');
const COLLECTION = 'jobs';
const BATCH_LIMIT = 450; // under Firestore's 500 to leave headroom

function collection() {
  return getFirestore().collection(COLLECTION);
}

/**
 * Split which of these jobKeys we already store.
 * One round trip regardless of how many keys — the hot path of every cron run.
 *
 * @param {string[]} jobKeys
 * @returns {Promise<Map<string, Object>>} existing jobs by key
 */
export async function findExisting(jobKeys) {
  const existing = new Map();
  if (!jobKeys.length) return existing;

  const db = getFirestore();
  for (const group of chunk([...new Set(jobKeys)], 200)) {
    const refs = group.map((key) => collection().doc(key));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      if (snapshot.exists) existing.set(snapshot.id, snapshot.data());
    }
  }

  return existing;
}

/**
 * Write jobs, creating new ones and merging updates into existing ones.
 * @param {import('../core/normalizedJob.js').NormalizedJob[]} jobs
 */
export async function saveJobs(jobs) {
  if (!jobs.length) return 0;
  const db = getFirestore();
  let written = 0;

  for (const group of chunk(jobs, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const job of group) {
      batch.set(
        collection().doc(job.jobKey),
        {
          ...job,
          // A server timestamp is the only reliable ordering key — client and
          // source clocks disagree, sometimes by days.
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
    written += group.length;
  }

  log.debug('saved', { count: written });
  return written;
}

/**
 * Recent jobs, newest first — the candidate pool for scoring.
 *
 * @param {Object} options
 * @param {number} options.sinceMs   Age window.
 * @param {number} options.limit
 * @returns {Promise<Object[]>}
 */
export async function findRecent({ sinceMs, limit = 300 }) {
  const cutoff = new Date(Date.now() - sinceMs).toISOString();

  const snapshot = await collection()
    .where('postedAt', '>=', cutoff)
    .orderBy('postedAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => doc.data());
}

/**
 * Candidate retrieval by tag — the fan-out-on-READ path.
 *
 * Not on the hot path today (we fan out on write), but it exists because it is
 * the ONLY query shape that scales past ~10k users on Firestore, and having it
 * behind the same repository means switching strategies is a config change
 * rather than a redesign. Firestore caps array-contains-any at 30 values.
 *
 * @param {string[]} tags e.g. ['skill:react','country:PK']
 */
export async function findByTags(tags, { sinceMs, limit = 200 }) {
  if (!tags.length) return findRecent({ sinceMs, limit });

  const cutoff = new Date(Date.now() - sinceMs).toISOString();
  const snapshot = await collection()
    .where('tags', 'array-contains-any', tags.slice(0, 30))
    .where('postedAt', '>=', cutoff)
    .orderBy('postedAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => doc.data());
}

/**
 * Stored jobs from a source that never got their detail pass.
 *
 * WHY THIS EXISTS: enrichment is budgeted (a handful of detail requests per
 * run) and used to be offered only to jobs that were new THAT run. Anything
 * that missed the budget was written with `enriched:false`, an empty
 * description and no skills — and was never looked at again, because on the
 * next run it was no longer new. 35% of stored LinkedIn jobs were stranded
 * that way, and a job with no detected skills cannot score highly, so those
 * were permanently locked out of the notification threshold.
 *
 * Oldest-first, so the backlog drains in posting order instead of starving the
 * same jobs forever.
 */
export async function findUnenriched(sourceId, { limit = 12, sinceMs } = {}) {
  /**
   * EQUALITY FILTERS ONLY — deliberately.
   *
   * Adding `.where('postedAt', '>=', cutoff)` makes this a composite query,
   * which Firestore refuses without a composite index this project cannot
   * create (the deploy service account has no Datastore Index Admin role).
   * The first version did exactly that, the error was swallowed by a
   * debug-level catch, and the backlog silently drained zero jobs forever.
   *
   * Equality-only queries are served by merging automatic single-field
   * indexes, so this needs no setup. Age is filtered in memory below — over a
   * page of 12, that costs nothing.
   */
  const snapshot = await collection()
    .where('sourceId', '==', sourceId)
    .where('enriched', '==', false)
    .limit(limit * 2)
    .get();

  const cutoff = sinceMs ? Date.now() - sinceMs : null;

  return snapshot.docs
    .map((doc) => doc.data())
    .filter((job) => !cutoff || new Date(job.postedAt).getTime() >= cutoff)
    .slice(0, limit);
}

/** @returns {Promise<Object|null>} */
export async function findByKey(jobKey) {
  const snapshot = await collection().doc(jobKey).get();
  return snapshot.exists ? snapshot.data() : null;
}

/** Fetch many jobs by key in one round trip (used to hydrate saved jobs). */
export async function findManyByKey(jobKeys) {
  if (!jobKeys.length) return [];
  const db = getFirestore();
  const jobs = [];

  for (const group of chunk([...new Set(jobKeys)], 200)) {
    const snapshots = await db.getAll(...group.map((key) => collection().doc(key)));
    for (const snapshot of snapshots) if (snapshot.exists) jobs.push(snapshot.data());
  }

  return jobs;
}

/**
 * Delete jobs older than the retention window.
 *
 * WHY retention exists: without it the collection grows forever, every recency
 * query gets slower, and Firestore storage costs climb for data nobody can
 * apply to anyway — a 40-day-old posting is almost always filled.
 */
export async function pruneOlderThan(ageMs, { limit = 300 } = {}) {
  const cutoff = new Date(Date.now() - ageMs).toISOString();
  const snapshot = await collection().where('postedAt', '<', cutoff).limit(limit).get();
  if (snapshot.empty) return 0;

  const db = getFirestore();
  for (const group of chunk(snapshot.docs, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const doc of group) batch.delete(doc.ref);
    await batch.commit();
  }

  log.info('pruned old jobs', { count: snapshot.size });
  return snapshot.size;
}

export function chunk(items, size) {
  const groups = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}
