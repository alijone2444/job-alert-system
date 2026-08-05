/**
 * Global quality blocklist — listings that are not real openings.
 *
 * WHY this is separate from a user's `blockedCompanies`: those are personal
 * preferences ("I don't want to work at X"). This list is about DATA QUALITY.
 * A handful of aggregator accounts scrape jobs from other boards and repost
 * them under their own name, so the posting a user clicks either 404s, leads to
 * a lead-capture form, or is months stale. They are not a taste question — they
 * are noise, and every user pays for them.
 *
 * These are rejected at the QUALITY GATE, before dedupe and before scoring, so
 * they never enter the shared job pool at all.
 *
 * Deliberately conservative. A legitimate staffing agency posting a real
 * opening is a real opening; only accounts that exist to bulk-repost other
 * people's listings belong here. Matching is substring on the NORMALISED
 * company name, so "Hire Feed", "HireFeed" and "Hire Feed Inc." all match.
 *
 * Extend at runtime without a redeploy:
 *   BLOCKED_COMPANIES=some company,another one
 */

/** Known bulk-repost / scraped-listing accounts. */
const DEFAULT_BLOCKED_COMPANIES = [
  'hire feed',
  'hirefeed',
  'lensa',
  'talentify',
  'clickjobs',
  'get it recruit',
  'jobs for humanity',
  'energy jobline',
  'crossover',
  'joblink',
  'jobsora',
  'jooble',
  'careerbuilder',
  'ziprecruiter',
];

/**
 * Title patterns that signal a listing is not a specific opening — a talent
 * pool, an evergreen "always hiring" post, or a placeholder.
 */
const DEFAULT_BLOCKED_TITLE_PATTERNS = [
  'talent pool',
  'talent community',
  'general application',
  'speculative application',
  'expression of interest',
  'future opportunities',
  'join our talent',
  'candidate pool',
  'test job',
];

function fromEnv(name) {
  return (process.env[name] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

const blockedCompanies = [...DEFAULT_BLOCKED_COMPANIES, ...fromEnv('BLOCKED_COMPANIES')];
const blockedTitles = [...DEFAULT_BLOCKED_TITLE_PATTERNS, ...fromEnv('BLOCKED_TITLE_PATTERNS')];

/**
 * Is this listing global noise rather than a real opening?
 *
 * @param {string} companyNorm normalised company name
 * @param {string} title       raw title
 * @returns {string|null} the reason, or null if the listing is fine
 */
export function findBlockReason(companyNorm, title) {
  const company = String(companyNorm || '').toLowerCase();
  for (const blocked of blockedCompanies) {
    if (company && company.includes(blocked)) return `reposter:${blocked}`;
  }

  const titleLower = ` ${String(title || '').toLowerCase()} `;
  for (const pattern of blockedTitles) {
    if (titleLower.includes(pattern)) return `not-a-real-opening:${pattern}`;
  }

  return null;
}

/** Exposed for the Status screen / diagnostics. */
export function describeBlocklist() {
  return { companies: blockedCompanies, titlePatterns: blockedTitles };
}
