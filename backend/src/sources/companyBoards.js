/**
 * Company board registry for the ATS adapters (Greenhouse / Lever / Ashby).
 *
 * WHY a registry instead of "scrape company career pages": there is no generic
 * way to scrape an arbitrary careers page — every one is a different React app.
 * But the overwhelming majority of tech companies do not build their own; they
 * host on Greenhouse, Lever or Ashby, all of which expose a FREE, stable,
 * key-less JSON API. So "company career pages" is implemented as "the ATS that
 * company's career page actually runs on", which is both honest and reliable.
 *
 * Adding a company is a one-line change here — no code, no deploy config.
 * Find the slug in the careers URL:
 *   boards.greenhouse.io/SLUG        -> greenhouse
 *   jobs.lever.co/SLUG               -> lever
 *   jobs.ashbyhq.com/SLUG            -> ashby
 *
 * Override at runtime with env vars (comma-separated), e.g.
 *   GREENHOUSE_BOARDS=stripe,figma,notion
 */

/**
 * Every slug below was verified live: the board resolves AND had postings in
 * the last 7 days. Slugs that 404'd or sat empty were dropped rather than left
 * in to waste a request on every run.
 */

/** @type {string[]} */
export const GREENHOUSE_BOARDS = [
  'anthropic',
  'stripe',
  'databricks',
  'gitlab',
  'samsara',
  'twilio',
  'reddit',
  'coinbase',
  'discord',
  'figma',
  'airbnb',
  'pinterest',
  'asana',
  'robinhood',
  'affirm',
  'instacart',
  'dropbox',
  'airtable',
];

/** @type {string[]} */
export const LEVER_BOARDS = [
  'spotify',
  'palantir',
  'binance',
  'veeva',
  'matchgroup',
  'tala',
  'fetchpackage',
];

/** @type {string[]} */
export const ASHBY_BOARDS = [
  'openai',
  'ramp',
  'notion',
  'linear',
  'perplexity',
  'elevenlabs',
  'supabase',
  'replit',
  'cursor',
  'vanta',
  'modal',
  'warp',
  'render',
];

/**
 * Read the board list for an ATS, letting env override the defaults.
 * @param {'greenhouse'|'lever'|'ashby'} ats
 * @returns {string[]}
 */
export function getBoards(ats) {
  const envKey = `${ats.toUpperCase()}_BOARDS`;
  const override = (process.env[envKey] || '')
    .split(',')
    .map((slug) => slug.trim())
    .filter(Boolean);
  if (override.length) return override;

  return {
    greenhouse: GREENHOUSE_BOARDS,
    lever: LEVER_BOARDS,
    ashby: ASHBY_BOARDS,
  }[ats] ?? [];
}

/**
 * Boards are polled round-robin across cron runs rather than all at once.
 *
 * WHY: 10 boards x ~1-4 MB of JSON in one 2-minute invocation would blow the
 * serverless time budget and re-download mostly-unchanged data. Rotating a
 * small slice per run keeps every run fast while still covering every board
 * within a few minutes.
 *
 * @param {string[]} boards
 * @param {number} sliceSize
 * @param {number} [nowMs]
 * @returns {string[]}
 */
export function rotateBoards(boards, sliceSize, nowMs = Date.now()) {
  if (!boards.length || sliceSize >= boards.length) return boards;
  // A 2-minute cron cadence => advance the window every 2 minutes.
  const tick = Math.floor(nowMs / 120_000);
  const offset = (tick * sliceSize) % boards.length;
  const rotated = [...boards.slice(offset), ...boards.slice(0, offset)];
  return rotated.slice(0, sliceSize);
}
