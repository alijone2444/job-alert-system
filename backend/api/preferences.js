/**
 * GET  /api/preferences?userId=   read current preferences
 * POST /api/preferences           update them
 *
 * A POST that changes anything scoring-relevant triggers an IMMEDIATE feed
 * rebuild before responding.
 *
 * WHY rebuild synchronously rather than waiting for the next cron tick: the
 * user is standing in the Personalize screen. Making them wait up to two
 * minutes to find out whether their change did anything is the difference
 * between a settings screen that feels alive and one that feels broken. The
 * rebuild is bounded (a few hundred candidate jobs, pure in-memory scoring) so
 * it comfortably fits inside a request.
 */

import { withApi, requireUserId, badRequest } from '../src/http/apiKit.js';
import * as usersRepo from '../src/repositories/usersRepo.js';
import { affectsScoring } from '../src/core/preferences.js';
import { rebuildUserFeed } from '../src/reco/fanout.js';
import { getScoringConfig } from '../src/repositories/settingsRepo.js';

export default withApi({ methods: ['GET', 'POST'] }, async (ctx) => {
  const userId = requireUserId(ctx);

  if (ctx.req.method === 'GET') {
    return { preferences: await usersRepo.getPreferences(userId) };
  }

  const patch = ctx.body?.preferences ?? ctx.body;
  if (!patch || typeof patch !== 'object') throw badRequest('preferences object is required');

  const { before, after } = await usersRepo.updatePreferences(userId, patch);

  // Cosmetic-only edits (e.g. toggling notifications) skip the rebuild.
  if (!affectsScoring(before, after)) {
    await usersRepo.markScored(userId, after.version);
    return { preferences: after, rebuilt: false };
  }

  const scoringConfig = await getScoringConfig();
  const result = await rebuildUserFeed(userId, { scoringConfig });

  return {
    preferences: after,
    rebuilt: true,
    matched: result.matched,
    scanned: result.scanned,
  };
});
