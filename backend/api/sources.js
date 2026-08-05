/**
 * GET /api/sources — every board the system knows about, plus live health.
 *
 * Includes sources we CANNOT currently fetch (Indeed, Wellfound, and Rozee
 * without a proxy) together with the reason. The Status screen renders those
 * honestly as unavailable instead of silently omitting them, so the roadmap is
 * visible rather than folklore.
 */

import { withApi } from '../src/http/apiKit.js';
import { describeSources } from '../src/sources/registry.js';
import { listSourceHealth } from '../src/repositories/settingsRepo.js';

export default withApi({ methods: ['GET'] }, async () => {
  const [sources, health] = await Promise.all([
    Promise.resolve(describeSources()),
    listSourceHealth(),
  ]);

  const healthById = new Map(health.map((entry) => [entry.id, entry]));

  return {
    sources: sources.map((source) => ({
      ...source,
      health: healthById.get(source.id) ?? null,
    })),
  };
});
