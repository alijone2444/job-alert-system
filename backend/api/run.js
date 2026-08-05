/**
 * GET /api/run — one full ingest -> score -> notify cycle.
 *
 * This is the endpoint cron-job.org has been hitting every 2 minutes. Its URL,
 * its auth (`?key=<RUN_SECRET>`) and its response shape are UNCHANGED — the
 * existing schedule keeps working with no reconfiguration. What changed is
 * everything behind it: it now runs a multi-source pipeline and personalises
 * per user instead of fetching LinkedIn and broadcasting to everyone.
 *
 * Env vars (Vercel -> Project Settings -> Environment Variables):
 *   FIREBASE_SERVICE_ACCOUNT   service-account JSON, one line   (required)
 *   RUN_SECRET                 guards this endpoint             (recommended)
 *   APP_API_KEY                guards the app-facing endpoints  (recommended)
 *   DISABLED_SOURCES           e.g. "remoteok,ashby"            (optional)
 *   GREENHOUSE_BOARDS / LEVER_BOARDS / ASHBY_BOARDS             (optional)
 *   SCRAPER_PROXY_URL          enables Rozee.pk                 (optional)
 */

import { runEngine } from '../src/engine.js';

/** The pipeline is budgeted to finish well inside this ceiling. */
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const secret = process.env.RUN_SECRET;
  const provided = (req.query && req.query.key) || req.headers['x-run-key'];
  if (secret && provided !== secret) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const exitCode = await runEngine();
    res.status(200).json({ ok: exitCode === 0, exitCode, at: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}
