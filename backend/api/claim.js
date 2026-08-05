/**
 * POST /api/claim — adopt a pre-auth, device-keyed profile into the account.
 *   { deviceId }
 *
 * Before sign-in existed the "user" was a device id, so preferences, saved jobs
 * and feeds accumulated under `users/android_<installId>`. When that same
 * handset signs in for the first time, that work belongs to the person now
 * holding the account — losing it because we introduced login would be a
 * regression they experience as data loss.
 *
 * SAFETY PROPERTIES, all of which matter:
 *  - The uid comes from the verified ID token, never the body. A caller cannot
 *    claim someone else's data into their own account.
 *  - Only DEVICE-shaped ids can be claimed, so one account can never absorb
 *    another account.
 *  - A device can only be claimed once; the source is tombstoned afterwards.
 *  - Merge is non-destructive: preferences already set on the account win, and
 *    the feed is left to rebuild from the (authoritative) preferences rather
 *    than being copied.
 */

import { withApi, requireUserId, badRequest, LEGACY_DEVICE_ID } from '../src/http/apiKit.js';
import { getFirestore } from '../src/firebase/admin.js';
import { hasAnyPreference } from '../src/core/preferences.js';
import { rebuildUserFeed } from '../src/reco/fanout.js';
import { getScoringConfig } from '../src/repositories/settingsRepo.js';
import { createLogger } from '../src/core/logger.js';

const log = createLogger('Claim');

/** Copy a subcollection across, without overwriting anything already there. */
async function copySubcollection(db, fromRef, toRef, name) {
  const source = await fromRef.collection(name).get();
  if (source.empty) return 0;

  const existing = await toRef.collection(name).get();
  const alreadyThere = new Set(existing.docs.map((doc) => doc.id));

  let batch = db.batch();
  let pending = 0;
  let copied = 0;

  for (const doc of source.docs) {
    if (alreadyThere.has(doc.id)) continue; // the account's own data wins
    batch.set(toRef.collection(name).doc(doc.id), doc.data(), { merge: true });
    copied++;
    if (++pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();

  return copied;
}

export default withApi({ methods: ['POST'] }, async (ctx) => {
  const uid = requireUserId(ctx);
  const deviceId = String(ctx.body?.deviceId || '').trim();

  if (!LEGACY_DEVICE_ID.test(deviceId)) {
    throw badRequest('deviceId must be a legacy device identifier');
  }
  if (deviceId === uid) throw badRequest('nothing to claim');

  const db = getFirestore();
  const deviceRef = db.collection('users').doc(deviceId);
  const accountRef = db.collection('users').doc(uid);

  const deviceSnapshot = await deviceRef.get();
  if (!deviceSnapshot.exists) return { migrated: false, reason: 'no device profile' };

  const deviceData = deviceSnapshot.data() || {};
  if (deviceData.claimedBy) {
    return { migrated: false, reason: deviceData.claimedBy === uid ? 'already claimed' : 'claimed by another account' };
  }

  /* ------------------------------ preferences ----------------------------- */
  // Only adopted if the account has none of its own — a fresh sign-in inherits
  // the device's setup, while a returning user's real preferences are never
  // silently replaced by whatever was on this handset.
  const devicePrefsRef = deviceRef.collection('settings').doc('preferences');
  const accountPrefsRef = accountRef.collection('settings').doc('preferences');

  const [devicePrefsSnap, accountPrefsSnap] = await Promise.all([
    devicePrefsRef.get(),
    accountPrefsRef.get(),
  ]);

  let adoptedPreferences = false;
  if (devicePrefsSnap.exists) {
    const devicePrefs = devicePrefsSnap.data();
    const accountPrefs = accountPrefsSnap.exists ? accountPrefsSnap.data() : null;

    if (hasAnyPreference(devicePrefs) && !hasAnyPreference(accountPrefs)) {
      await accountPrefsRef.set({ ...devicePrefs, version: (accountPrefs?.version ?? 0) + 1 }, { merge: false });
      adoptedPreferences = true;
    }
  }

  /* ----------------------------- interactions ----------------------------- */
  // Saved / hidden / applied are pure user intent and always worth keeping.
  const interactions = await copySubcollection(db, deviceRef, accountRef, 'interactions');

  /* -------------------------------- finish -------------------------------- */
  // The feed is NOT copied. It is derived data — rebuilding it from the
  // account's preferences is both cheaper and guaranteed correct, whereas
  // copying could carry entries scored against preferences we just replaced.
  await accountRef.set(
    {
      claimedDeviceId: deviceId,
      claimedAt: new Date().toISOString(),
      // Force a rebuild on the next cron run even if the API rebuild below fails.
      prefsVersion: (await accountPrefsRef.get()).data()?.version ?? 1,
      lastScoredPrefsVersion: -1,
    },
    { merge: true }
  );

  await deviceRef.set({ claimedBy: uid, claimedAt: new Date().toISOString() }, { merge: true });

  let matched = 0;
  try {
    const scoringConfig = await getScoringConfig();
    ({ matched } = await rebuildUserFeed(uid, { scoringConfig }));
  } catch (error) {
    log.warn('rebuild after claim failed — the cron will pick it up', { error: error.message });
  }

  log.info('claimed device profile', { uid, deviceId, adoptedPreferences, interactions, matched });

  return {
    migrated: true,
    moved: { preferences: adoptedPreferences ? 1 : 0, interactions, feedMatches: matched },
  };
});
