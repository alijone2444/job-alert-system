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

/** Device-shaped ids from before accounts existed. Mirrors apiKit's pattern. */
const LEGACY_DEVICE_ID = /^(android|ios)_[A-Za-z0-9_-]+$/;

/** A pre-auth profile is dead once it has been inactive for this long. */
const STALE_DEVICE_MS = 7 * 24 * 60 * 60 * 1000;

/** Firestore may return either our ISO string or a Timestamp from older data. */
function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isActiveUser(user, cutoff) {
  if (user.claimedBy) return false;
  if (!LEGACY_DEVICE_ID.test(user.userId)) return true; // a real account
  return timestampToMs(user.lastSeenAt) >= cutoff;
}

/**
 * Users the pipeline should actually serve.
 *
 * TWO CLASSES OF DEAD PROFILE are filtered out here, and both caused real
 * problems:
 *
 *  1. CLAIMED devices. After sign-in, /api/claim copies a device profile into
 *     the account and tombstones it. If it kept being fanned out to, the same
 *     phone would be scored twice and receive DUPLICATE notifications — one
 *     for the account and one for its own former device id.
 *
 *  2. ABANDONED devices. Old installs leave behind profiles that will never be
 *     claimed. Scoring them burns reads and writes from a 50,000/day budget on
 *     feeds nobody will ever open.
 *
 * Accounts (uid-shaped ids) are NEVER filtered — only pre-auth device profiles
 * can go stale, and only after a week of silence.
 */
export async function listUsers({ limit = 500, includeInactive = false } = {}) {
  const snapshot = await getFirestore().collection(USERS).limit(limit).get();
  const users = snapshot.docs.map((doc) => ({ userId: doc.id, ...doc.data() }));
  if (includeInactive) return users;

  const cutoff = Date.now() - STALE_DEVICE_MS;

  return users.filter((user) => isActiveUser(user, cutoff));
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
  const cutoff = Date.now() - STALE_DEVICE_MS;

  snapshot.forEach((doc) => {
    const user = { userId: doc.id, ...doc.data() };
    if (!isActiveUser(user, cutoff)) return;

    const token = user.fcmToken;
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
