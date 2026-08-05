/**
 * User<->job interactions: saved, hidden, applied.
 *
 * `users/{userId}/interactions/{jobKey}`
 *
 * WHY one collection with a `state` field instead of three collections: a job
 * is in exactly one of these states at a time (saving a hidden job should
 * un-hide it), and a single document per job makes that invariant impossible
 * to violate. It also means the app needs one listener, not three.
 *
 * `appliedAt` is tracked separately from `state` because applying is an EVENT,
 * not a state you leave — a user can save a job and later apply to it, and we
 * want both facts.
 */

import admin from 'firebase-admin';
import { getFirestore } from '../firebase/admin.js';
import { chunk } from './jobsRepo.js';

export const INTERACTION = {
  SAVED: 'saved',
  HIDDEN: 'hidden',
  NONE: 'none',
};

function interactionsRef(userId) {
  return getFirestore().collection('users').doc(userId).collection('interactions');
}

/**
 * Set the state of a job for a user.
 * @param {string} userId
 * @param {string} jobKey
 * @param {'saved'|'hidden'|'none'} state
 * @param {Object} [snapshot] display fields, so Saved works offline / after the
 *                            job is pruned from the shared `jobs` collection
 */
export async function setState(userId, jobKey, state, snapshot = null) {
  const ref = interactionsRef(userId).doc(jobKey);

  if (state === INTERACTION.NONE) {
    // Preserve an apply record even when the user un-saves the job.
    const existing = await ref.get();
    if (existing.exists && existing.data()?.appliedAt) {
      await ref.set({ state: INTERACTION.NONE, updatedAt: new Date().toISOString() }, { merge: true });
    } else {
      await ref.delete();
    }
    return;
  }

  await ref.set(
    {
      jobKey,
      state,
      ...(snapshot ? { snapshot } : {}),
      updatedAt: new Date().toISOString(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Record that the user opened the original posting.
 *
 * We never proxy or replicate an application — `applyUrl` opens the source site
 * in the browser. This only records that the tap happened, which powers the
 * "Applied" filter and, later, feedback-driven ranking.
 */
export async function recordApply(userId, jobKey, snapshot = null) {
  await interactionsRef(userId)
    .doc(jobKey)
    .set(
      {
        jobKey,
        appliedAt: new Date().toISOString(),
        ...(snapshot ? { snapshot } : {}),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/** @returns {Promise<{saved:string[], hidden:string[], applied:string[]}>} */
export async function getStates(userId) {
  const snapshot = await interactionsRef(userId).get();
  const saved = [];
  const hidden = [];
  const applied = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.state === INTERACTION.SAVED) saved.push(doc.id);
    if (data.state === INTERACTION.HIDDEN) hidden.push(doc.id);
    if (data.appliedAt) applied.push(doc.id);
  });

  return { saved, hidden, applied };
}

/**
 * Full documents for a state — used to render the Saved tab without a join.
 *
 * Equality filter only, sorted in memory: adding `.orderBy('createdAt')` would
 * demand a composite index for no user-visible benefit at these list sizes.
 * Same reasoning as feedRepo.listFeed().
 */
export async function listByState(userId, state, { limit = 200 } = {}) {
  const snapshot = await interactionsRef(userId).where('state', '==', state).limit(limit).get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0));
}

/**
 * Hidden job keys, as a Set for O(1) filtering during fan-out.
 * Hiding must survive a rescore — otherwise every preference tweak resurrects
 * everything the user has already dismissed.
 */
export async function getHiddenKeys(userId) {
  const snapshot = await interactionsRef(userId).where('state', '==', INTERACTION.HIDDEN).get();
  return new Set(snapshot.docs.map((doc) => doc.id));
}

/** Bulk-fetch hidden keys for many users in one pass (cron fan-out). */
export async function getHiddenKeysForUsers(userIds) {
  const byUser = new Map();
  for (const group of chunk(userIds, 10)) {
    await Promise.all(
      group.map(async (userId) => {
        byUser.set(userId, await getHiddenKeys(userId));
      })
    );
  }
  return byUser;
}
