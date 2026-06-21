// Vercel serverless endpoint: runs ONE fetch -> dedup -> notify cycle.
// An external cron (e.g. cron-job.org, free) hits this URL every 1-2 min:
//   https://<your-vercel-app>.vercel.app/api/run?key=YOUR_RUN_SECRET
//
// Env vars to set in Vercel (Project Settings -> Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT  = the service-account JSON (one line)
//   LINKEDIN_SEARCH_URL       = your LinkedIn keyword search URL
//   KEYWORD_FILTER            = the dev-role title filter
//   UPWORK_ENABLED            = false
//   RUN_SECRET                = any random string (so only you can trigger it)
import { runEngine } from '../src/engine.js';

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
