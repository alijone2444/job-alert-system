/**
 * Re-run salary extraction over stored jobs after fixing the detector.
 *
 * Salary is derived from the description, so a detector bug leaves wrong
 * figures baked into `jobs/` AND into every user's denormalised feed entry.
 * Jobs are not re-processed on later runs (that is the point of dedupe), so
 * without this sweep a "$145k/month" would sit in someone's feed until
 * retention removed it a month later.
 *
 *   node scripts/refix-salaries.mjs            # dry run
 *   node scripts/refix-salaries.mjs --apply
 */

import { loadConfig } from '../src/config.js';
import { initFirebase, getFirestore } from '../src/firebase/admin.js';
import { detectSalary, toAnnualUsd } from '../src/core/taxonomy.js';

const apply = process.argv.includes('--apply');

initFirebase(loadConfig().firebaseServiceAccount);
const db = getFirestore();

function describe(salary) {
  if (!salary) return 'none';
  return `${salary.currency} ${salary.min ?? '?'}${salary.max ? '-' + salary.max : ''}/${salary.period}`;
}

const snapshot = await db.collection('jobs').get();
const changes = [];

snapshot.forEach((doc) => {
  const job = doc.data();

  // Only jobs whose salary we INFERRED from prose. Ashby's structured
  // compensation is authoritative and must not be second-guessed by a regex.
  if (job.sourceId === 'ashby') return;
  if (!job.description) return;

  const before = job.salary ?? null;
  const after = detectSalary(job.description);

  if (describe(before) === describe(after)) return;

  /**
   * Only ever overwrite with a NEW figure, never with nothing.
   *
   * Descriptions are truncated to 4,000 characters on write, and long postings
   * carry their pay band near the end — so a stored salary can be perfectly
   * correct while being invisible to a re-scan of the truncated text. Treating
   * "I can't find it now" as "there isn't one" would have wiped 25 valid
   * salaries in a dry run.
   */
  if (!after) return;

  changes.push({ jobKey: doc.id, title: job.title, company: job.company, before, after });
});

console.log(`Scanned ${snapshot.size} jobs — ${changes.length} salary corrections.`);
for (const change of changes.slice(0, 20)) {
  console.log(
    `  ${(change.company || '?').slice(0, 18).padEnd(18)} ${change.title.slice(0, 34).padEnd(34)} ${describe(change.before)} -> ${describe(change.after)}`
  );
}
if (changes.length > 20) console.log(`  … and ${changes.length - 20} more`);

if (!changes.length) process.exit(0);
if (!apply) {
  console.log('\nDry run. Re-run with --apply to write these back.');
  process.exit(0);
}

/* -------------------------------- apply ---------------------------------- */

const byKey = new Map(changes.map((change) => [change.jobKey, change.after]));

let batch = db.batch();
let pending = 0;
for (const change of changes) {
  batch.set(
    db.collection('jobs').doc(change.jobKey),
    { salary: change.after, salaryAnnualUsd: toAnnualUsd(change.after) },
    { merge: true }
  );
  if (++pending >= 400) {
    await batch.commit();
    batch = db.batch();
    pending = 0;
  }
}
if (pending) await batch.commit();
console.log(`Updated ${changes.length} job document(s).`);

// Feed entries carry their own copy — fan-out-on-write means fixing the source
// of truth does not fix what users actually see.
const users = await db.collection('users').get();
let feedUpdates = 0;

for (const user of users.docs) {
  const feed = await db.collection('users').doc(user.id).collection('feed').get();
  const stale = feed.docs.filter((doc) => byKey.has(doc.id));
  if (!stale.length) continue;

  let feedBatch = db.batch();
  let count = 0;
  for (const doc of stale) {
    feedBatch.set(doc.ref, { salary: byKey.get(doc.id) }, { merge: true });
    if (++count >= 400) {
      await feedBatch.commit();
      feedBatch = db.batch();
      count = 0;
    }
  }
  if (count) await feedBatch.commit();

  feedUpdates += stale.length;
  console.log(`  ${user.id}: corrected ${stale.length} feed entr${stale.length === 1 ? 'y' : 'ies'}`);
}

console.log(`Done — ${feedUpdates} feed entr${feedUpdates === 1 ? 'y' : 'ies'} corrected.`);
