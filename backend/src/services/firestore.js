import admin from 'firebase-admin';
import { getFirestore } from '../firebase/admin.js';

const JOBS_COLLECTION = 'jobs';
const USERS_COLLECTION = 'users';

/**
 * Check whether a job document already exists.
 * @param {string} jobId
 * @returns {Promise<boolean>}
 */
export async function jobExists(jobId) {
  const doc = await getFirestore().collection(JOBS_COLLECTION).doc(sanitizeDocId(jobId)).get();
  return doc.exists;
}

/**
 * Persist a new job to Firestore.
 * @param {object} job
 */
export async function saveJob(job) {
  const docId = sanitizeDocId(job.id);

  await getFirestore()
    .collection(JOBS_COLLECTION)
    .doc(docId)
    .set({
      jobId: job.id,
      platform: job.platform,
      title: job.title,
      link: job.link,
      description: job.description || '',
      company: job.company || '',
      location: job.location || '',
      publishedAt: job.publishedAt,
      notifiedAt: new Date().toISOString(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/**
 * Firestore doc IDs cannot contain forward slashes.
 */
function sanitizeDocId(id) {
  return id.replace(/\//g, '_');
}

/**
 * Fetch all active FCM tokens from the users collection.
 * @returns {Promise<string[]>}
 */
export async function getActiveDeviceTokens() {
  const snapshot = await getFirestore().collection(USERS_COLLECTION).get();

  if (snapshot.empty) {
    console.warn('[Firestore] No registered devices in users collection');
    return [];
  }

  const tokens = [];
  const staleDocs = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data?.fcmToken && typeof data.fcmToken === 'string') {
      tokens.push(data.fcmToken);
    } else {
      staleDocs.push(doc.id);
    }
  });

  if (staleDocs.length) {
    console.warn(`[Firestore] ${staleDocs.length} user doc(s) missing fcmToken`);
  }

  return [...new Set(tokens)];
}

/**
 * Remove invalid FCM tokens from user documents.
 * @param {string[]} invalidTokens
 */
export async function removeInvalidTokens(invalidTokens) {
  if (!invalidTokens.length) return;

  const db = getFirestore();
  const snapshot = await db.collection(USERS_COLLECTION).get();
  const batch = db.batch();
  let updates = 0;

  snapshot.forEach((doc) => {
    if (invalidTokens.includes(doc.data()?.fcmToken)) {
      batch.update(doc.ref, {
        fcmToken: null,
        tokenInvalidatedAt: new Date().toISOString(),
      });
      updates++;
    }
  });

  if (updates > 0) {
    await batch.commit();
    console.log(`[Firestore] Cleared ${updates} invalid FCM token(s)`);
  }
}
