/**
 * POST /api/rescore — force-rebuild one user's feed.
 *   { userId }
 *
 * Powers the app's pull-to-refresh / "Refresh feed" action. Distinct from
 * `/api/run`: this rescores the EXISTING job pool against the user's current
 * preferences and never fetches from a source, so it is fast, safe to call
 * repeatedly, and cannot trip a board's rate limit.
 */

import { withApi, requireUserId } from '../src/http/apiKit.js';
import { rebuildUserFeed } from '../src/reco/fanout.js';
import { getScoringConfig } from '../src/repositories/settingsRepo.js';

export default withApi({ methods: ['POST'] }, async (ctx) => {
  const userId = requireUserId(ctx);
  const scoringConfig = await getScoringConfig();
  const result = await rebuildUserFeed(userId, { scoringConfig });

  return { userId, ...result };
});
