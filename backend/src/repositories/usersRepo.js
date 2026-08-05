/**
 * Users + preferences repository.
 *
 * Firestore layout:
 *   users/{userId}                       device registration + FCM token
 *   users/{userId}/settings/preferences  the personalisation document
 *
 * WHY preferences live in a SUBCOLLECTION rather than as a field on the user
 * doc: the user doc is read on every cron run (to get FCM tokens) while
 * preferences are only read when scoring. Splitting them keeps the hot read
 * small, and lets the app subscribe to preference changes without waking up on
 * every token refresh.
 *
 * `userId` is currently the device id — there is no auth yet. Every function
 * here takes it as an opaque string, so introducing Firebase Auth later means
 * passing a uid instead, and nothing else changes.
 */

import admin from 'firebase-admin';
import { getFirestore } from '../firebase/admin.js';
import { createLogger } from '../core/logger.js';
import { defaultPreferences, sanitizePreferences } from '../core/preferences.js';

const log = createLogger('UsersRepo');
const USERS = 'users';
const PREFERENCES_DOC = 'settings/preferences';

function userRef(userId) {
  return getFirestore().collection(USERS).doc(userId);
}

function preferencesRef(userId) {
  return userRef(userId).collection('settings').doc('preferences');
}

/** All registered devices/users. Small collection today; paginate when it isn't. */
export async function listUsers({ limit = 500 } = {}) {
  const snapshot = await getFirestore().collection(USERS).limit(limit).get();
  return snapshot.docs.map((doc) => ({ userId: doc.id, ...doc.data() }));
}

/** @returns {Promise<Object|null>} */
export async function getUser(userId) {
  const snapshot = await userRef(userId).get();
  return snapshot.exists ? { userId, ...snapshot.data() } : null;
}

/** Register or refresh a device. Idempotent. */
export async function upsertUser(userId, data) {
  await userRef(userId).set(
    { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

/**
 * Read a user's preferences, falling back to defaults for users who have never
 * opened the Personalize tab.
 */
export async function getPreferences(userId) {
  const snapshot = await preferencesRef(userId).get();
  if (!snapshot.exists) return defaultPreferences();
  return { ...defaultPreferences(), ...snapshot.data() };
}

/**
 * Fetch preferences for many users at once — the cron scores every user on
 * every run, so N sequential reads would dominate the run time.
 */
export async function getPreferencesForUsers(userIds) {
  if (!userIds.length) return new Map();

  const db = getFirestore();
  const refs = userIds.map((userId) => preferencesRef(userId));
  const snapshots = await db.getAll(...refs);

  const byUser = new Map();
  snapshots.forEach((snapshot, index) => {
    byUser.set(
      userIds[index],
      snapshot.exists ? { ...defaultPreferences(), ...snapshot.data() } : defaultPreferences()
    );
  });

  return byUser;
}

/**
 * Patch preferences. Returns both versions so the caller can decide whether a
 * rescore is warranted.
 *
 * @returns {Promise<{before:Object, after:Object}>}
 */
export async function updatePreferences(userId, patch) {
  const before = await getPreferences(userId);
  const after = sanitizePreferences(patch, before);

  await preferencesRef(userId).set(after, { merge: false });
  // Mirror the version onto the user doc so the cron can spot stale feeds with
  // a single collection read instead of N subcollection reads.
  await userRef(userId).set({ prefsVersion: after.version }, { merge: true });

  log.info('preferences updated', { userId, version: after.version });
  return { before, after };
}

/** Mark that this user's feed has been rebuilt for the given prefs version. */
export async function markScored(userId, prefsVersion) {
  await userRef(userId).set(
    { lastScoredPrefsVersion: prefsVersion, lastScoredAt: new Date().toISOString() },
    { merge: true }
  );
}

/**
 * Active FCM tokens keyed by user, so notifications can be targeted per person
 * instead of broadcast to everyone (the old behaviour).
 * @returns {Promise<Map<string,string>>}
 */
export async function getTokensByUser() {
  const snapshot = await getFirestore().collection(USERS).get();
  const tokens = new Map();

  snapshot.forEach((doc) => {
    const token = doc.data()?.fcmToken;
    if (typeof token === 'string' && token.length > 20) tokens.set(doc.id, token);
  });

  return tokens;
}

/** Clear tokens FCM told us are dead, so we stop paying to retry them. */
export async function clearInvalidTokens(userIds) {
  if (!userIds.length) return;
  const db = getFirestore();
  const batch = db.batch();

  for (const userId of userIds) {
    batch.set(
      userRef(userId),
      { fcmToken: null, tokenInvalidatedAt: new Date().toISOString() },
      { merge: true }
    );
  }

  await batch.commit();
  log.warn('cleared invalid tokens', { count: userIds.length });
}
