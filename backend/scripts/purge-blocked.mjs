/**
 * Retroactively remove jobs that the blocklist now rejects.
 *
 * The quality gate stops NEW blocked listings from entering the pool, but jobs
 * ingested before a blocklist entry existed are already stored and already
 * sitting in users' feeds. This sweeps them out of both.
 *
 *   node scripts/purge-blocked.mjs            # dry run — shows what would go
 *   node scripts/purge-blocked.mjs --apply    # actually delete
 */

import { loadConfig } from '../src/config.js';
import { initFirebase, getFirestore } from '../src/firebase/admin.js';
import { findBlockReason } from '../src/core/blocklist.js';

const apply = process.argv.includes('--apply');

const config = loadConfig();
initFirebase(config.firebaseServiceAccount);
const db = getFirestore();

/* ------------------------------- find them ------------------------------- */

const snapshot = await db.collection('jobs').get();
const doomed = [];

snapshot.forEach((doc) => {
  const job = doc.data();
  const reason = findBlockReason(job.companyNorm, job.title);
  if (reason) doomed.push({ jobKey: doc.id, company: job.company, title: job.title, reason });
});

console.log(`Scanned ${snapshot.size} jobs — ${doomed.length} now blocked.`);
for (const job of doomed.slice(0, 25)) {
  console.log(`  [${job.reason}] ${job.company} — ${job.title.slice(0, 60)}`);
}
if (doomed.length > 25) console.log(`  … and ${doomed.length - 25} more`);

if (!doomed.length) process.exit(0);

if (!apply) {
  console.log('\nDry run. Re-run with --apply to delete these and remove them from every feed.');
  process.exit(0);
}

/* -------------------------------- delete --------------------------------- */

const blockedKeys = new Set(doomed.map((job) => job.jobKey));

// 1. The shared pool.
let batch = db.batch();
let pending = 0;
for (const job of doomed) {
  batch.delete(db.collection('jobs').doc(job.jobKey));
  if (++pending >= 400) {
    await batch.commit();
    batch = db.batch();
    pending = 0;
  }
}
if (pending) await batch.commit();
console.log(`Deleted ${doomed.length} job document(s).`);

// 2. Every user's materialised feed. Fan-out-on-write means a deleted job does
//    NOT disappear from feeds on its own — the copies have to be swept too.
const users = await db.collection('users').get();
let removedFromFeeds = 0;

for (const user of users.docs) {
  const feed = await db.collection('users').doc(user.id).collection('feed').get();
  const stale = feed.docs.filter((doc) => blockedKeys.has(doc.id));
  if (!stale.length) continue;

  let feedBatch = db.batch();
  let count = 0;
  for (const doc of stale) {
    feedBatch.delete(doc.ref);
    if (++count >= 400) {
      await feedBatch.commit();
      feedBatch = db.batch();
      count = 0;
    }
  }
  if (count) await feedBatch.commit();

  removedFromFeeds += stale.length;
  console.log(`  ${user.id}: removed ${stale.length} feed entr${stale.length === 1 ? 'y' : 'ies'}`);
}

console.log(`Done — ${removedFromFeeds} feed entr${removedFromFeeds === 1 ? 'y' : 'ies'} removed.`);
