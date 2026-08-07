/**
 * GET /api/feed — the personalised feed.
 *
 *   ?userId=<deviceId>      required
 *   &limit=1..100           default 30
 *   &cursor=<score>:<iso>   opaque pagination cursor
 *   &minScore=0..100        client-side floor on top of the user's threshold
 *   &source=linkedin        filter by board
 *   &workplace=remote       filter by workplace
 *   &search=react           free-text filter over title/company
 *
 * NOTE ON THE READ PATH: the app subscribes to `users/{id}/feed` via Firestore
 * for live updates, so this endpoint is not on the hot path for the main list.
 * It exists for pagination beyond the live window, for filtered queries the
 * client should not run locally, and as the interface a future web client or a
 * fan-out-on-read migration would use unchanged.
 */

import { withApi, requireUserId, parseIntParam } from '../src/http/apiKit.js';
import * as feedRepo from '../src/repositories/feedRepo.js';
import * as usersRepo from '../src/repositories/usersRepo.js';
import * as interactionsRepo from '../src/repositories/interactionsRepo.js';

/** The feed is ordered by time, so the cursor is just a timestamp. */
function parseCursor(raw) {
  if (!raw) return null;
  const postedAt = String(raw);
  return Number.isNaN(new Date(postedAt).getTime()) ? null : { postedAt };
}

function encodeCursor(cursor) {
  return cursor ? cursor.postedAt : null;
}

export default withApi({ methods: ['GET'] }, async (ctx) => {
  const userId = requireUserId(ctx);
  const { query } = ctx;

  const limit = parseIntParam(query.limit, 30, { min: 1, max: 100 });
  const minScore = parseIntParam(query.minScore, 0, { min: 0, max: 100 });

  const [preferences, states] = await Promise.all([
    usersRepo.getPreferences(userId),
    interactionsRepo.getStates(userId),
  ]);

  const hidden = new Set(states.hidden);
  const saved = new Set(states.saved);
  const applied = new Set(states.applied);

  // Over-fetch, because hidden entries and client filters thin the page out
  // and returning 12 items for a limit of 30 looks like the end of the feed.
  const page = await feedRepo.listFeed(userId, {
    limit: Math.min(100, limit * 2),
    cursor: parseCursor(query.cursor),
    minScore,
  });

  const search = String(query.search || '').trim().toLowerCase();

  const items = page.items
    .filter((item) => !hidden.has(item.jobKey))
    .filter((item) => !query.source || item.source === query.source)
    .filter((item) => !query.workplace || item.workplace === query.workplace)
    .filter((item) => {
      if (!search) return true;
      return `${item.title} ${item.company || ''} ${item.location || ''}`
        .toLowerCase()
        .includes(search);
    })
    .slice(0, limit)
    .map((item) => ({
      ...item,
      isSaved: saved.has(item.jobKey),
      isApplied: applied.has(item.jobKey),
    }));

  return {
    items,
    nextCursor: encodeCursor(page.nextCursor),
    meta: {
      feedThreshold: preferences.feedThreshold,
      notifyThreshold: preferences.notifyThreshold,
      returned: items.length,
    },
  };
});
