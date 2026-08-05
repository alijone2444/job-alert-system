/**
 * POST /api/register — register a device and its FCM token.
 *   { userId, fcmToken, platform, appVersion }
 *
 * Idempotent: the app calls it on every launch and on every token refresh.
 * A first-time registration seeds `prefsVersion` so the next cron run treats
 * the user as needing an initial feed build — which is why a brand-new install
 * has content within two minutes instead of waiting for jobs to trickle in.
 */

import { withApi, requireUserId, badRequest } from '../src/http/apiKit.js';
import * as usersRepo from '../src/repositories/usersRepo.js';

export default withApi({ methods: ['POST'] }, async (ctx) => {
  const userId = requireUserId(ctx);
  const { fcmToken, platform, appVersion } = ctx.body || {};

  if (fcmToken !== undefined && typeof fcmToken !== 'string') {
    throw badRequest('fcmToken must be a string');
  }

  const existing = await usersRepo.getUser(userId);
  const isNew = !existing;

  await usersRepo.upsertUser(userId, {
    ...(fcmToken ? { fcmToken } : {}),
    platform: platform || existing?.platform || 'unknown',
    appVersion: appVersion || existing?.appVersion || null,
    ...(isNew ? { prefsVersion: 1, lastScoredPrefsVersion: 0 } : {}),
    lastSeenAt: new Date().toISOString(),
  });

  return {
    userId,
    isNew,
    preferences: await usersRepo.getPreferences(userId),
  };
});
