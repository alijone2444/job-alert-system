/**
 * The NormalizedJob contract — the ONE shape every source must produce.
 *
 * WHY a hard contract: the recommendation engine, the deduper, the API and the
 * mobile app all read jobs. If a new adapter can emit an arbitrary object, a
 * missing field silently becomes `undefined` and Firestore rejects the write at
 * 2am on a cron run. Instead every adapter returns raw data, and this module is
 * the only place allowed to construct a job document. Unknown values are
 * explicitly `null` (meaning "we don't know"), never `undefined`.
 *
 * IMPORTANT semantic: `null` means UNKNOWN, not "no". The scorer treats unknown
 * as neutral so a source with thin metadata never drags a good job below the
 * threshold.
 */

import { createHash } from 'crypto';
import { COUNTRY_WORLDWIDE } from './taxonomy.js';

/**
 * @typedef {Object} NormalizedJob
 * @property {string}   jobKey          Deterministic dedupe key (doc id).
 * @property {string}   sourceId        Adapter that produced this (e.g. 'linkedin').
 * @property {string}   sourceJobId     The source's own id.
 * @property {string[]} seenInSources   Every source this job has arrived from.
 * @property {string}   title
 * @property {string}   titleNorm       Lowercased, noise-stripped title (dedupe).
 * @property {string}   company
 * @property {string}   companyNorm
 * @property {string}   location        Raw location text as shown to the user.
 * @property {string|null} country      Canonical country id, or 'WW', or null.
 * @property {string|null} workplace    remote | hybrid | onsite | null
 * @property {string|null} jobType      full_time | part_time | ... | null
 * @property {string|null} experienceLevel entry | junior | mid | senior | lead | null
 * @property {string[]}    skills       Canonical skill ids detected in the job.
 * @property {Object|null} salary       {min,max,currency,period} or null.
 * @property {number|null} salaryAnnualUsd Comparable annual figure, or null.
 * @property {string}   description     Plain text, truncated.
 * @property {string}   applyUrl        ORIGINAL posting URL — we never proxy applies.
 * @property {string}   postedAt        ISO timestamp.
 * @property {string}   ingestedAt      ISO timestamp.
 * @property {string[]} tags            Flat index for array-contains-any queries.
 * @property {Object}   quality         {score, flags[]}
 * @property {boolean}  enriched        Whether the detail-fetch pass has run.
 */

/** Descriptions are stored for scoring/preview only — cap the write size. */
const MAX_DESCRIPTION = 4000;

/**
 * Strip the noise that makes the same job look different across sources.
 * "Senior React Native Developer (Remote) - Urgent Hiring!!" -> "react native developer"
 */
export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ') // (Remote), [Contract]
    .replace(/\b(urgent|hiring|immediate joiner|apply now|w2|c2c|onsite|remote|hybrid)\b/g, ' ')
    .replace(/\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|mid|mid-level|entry|associate|i{1,3}|iv)\b/g, ' ')
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Company names differ cosmetically between boards ("Acme, Inc." vs "Acme").
 */
export function normalizeCompany(company) {
  return String(company || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|pvt|private|co|company|technologies|technology|solutions|systems|labs|software|studio|group|holdings)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The dedupe key. Same title + company + country = same job, regardless of
 * which board it came from.
 *
 * WHY not include the URL: the whole point is that LinkedIn and Greenhouse post
 * the SAME job at different URLs. Including the URL would defeat dedupe.
 * WHY include country: multinationals genuinely post the same title in Lahore
 * and London and those are different jobs.
 */
export function buildJobKey({ titleNorm, companyNorm, country }) {
  const basis = `${titleNorm}|${companyNorm}|${country || COUNTRY_WORLDWIDE}`;
  return createHash('sha1').update(basis).digest('hex').slice(0, 24);
}

/**
 * Build the flat tag array used for cheap candidate retrieval.
 *
 * WHY: Firestore cannot do "score > 80 for user X" server-side. But it CAN do
 * `where('tags','array-contains-any',[...])`. Tagging every job with its
 * skills/country/type/level means a future fan-out-on-READ implementation can
 * fetch a small candidate set instead of scanning every job. Costs one array
 * field today, saves the architecture later.
 */
function buildTags(job) {
  const tags = [];
  for (const skill of job.skills) tags.push(`skill:${skill}`);
  if (job.country) tags.push(`country:${job.country}`);
  if (job.workplace) tags.push(`workplace:${job.workplace}`);
  if (job.jobType) tags.push(`type:${job.jobType}`);
  if (job.experienceLevel) tags.push(`level:${job.experienceLevel}`);
  tags.push(`source:${job.sourceId}`);
  // Firestore caps array-contains-any at 30 values; keep the array bounded too.
  return tags.slice(0, 40);
}

/**
 * Grade a job so obviously-broken listings never reach a user's feed.
 * Returns 0-100 plus the reasons, which the Status screen surfaces.
 */
function assessQuality(job) {
  const flags = [];
  let score = 100;

  if (!job.title || job.title.length < 3) {
    flags.push('missing_title');
    score -= 60;
  }
  if (!job.company) {
    flags.push('missing_company');
    score -= 25;
  }
  if (!job.applyUrl || !/^https?:\/\//i.test(job.applyUrl)) {
    flags.push('missing_apply_url');
    score -= 60;
  }
  if (!job.skills.length) {
    flags.push('no_skills_detected');
    score -= 15;
  }
  if (!job.location && !job.country) {
    flags.push('no_location');
    score -= 10;
  }
  if (job.title && job.title.length > 160) {
    flags.push('suspicious_title_length');
    score -= 10;
  }

  return { score: Math.max(0, score), flags };
}

/**
 * Construct a validated NormalizedJob. Adapters call this — nothing else
 * writes job documents.
 *
 * @param {Object} input
 * @returns {NormalizedJob}
 */
export function createNormalizedJob(input) {
  const title = clean(input.title);
  const company = clean(input.company);
  const titleNorm = normalizeTitle(title);
  const companyNorm = normalizeCompany(company);
  const country = input.country || null;

  const job = {
    jobKey: buildJobKey({ titleNorm, companyNorm, country }),
    sourceId: input.sourceId,
    sourceJobId: String(input.sourceJobId ?? ''),
    seenInSources: [input.sourceId],

    title,
    titleNorm,
    company,
    companyNorm,
    location: clean(input.location),
    country,

    workplace: input.workplace || null,
    jobType: input.jobType || null,
    experienceLevel: input.experienceLevel || null,
    skills: Array.isArray(input.skills) ? [...new Set(input.skills)] : [],

    salary: input.salary || null,
    salaryAnnualUsd: input.salaryAnnualUsd ?? null,

    description: clean(input.description).slice(0, MAX_DESCRIPTION),
    applyUrl: clean(input.applyUrl),

    postedAt: toIso(input.postedAt) || new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    enriched: Boolean(input.enriched),
  };

  job.tags = buildTags(job);
  job.quality = assessQuality(job);
  return job;
}

/**
 * A job is publishable if nothing structurally essential is missing. Jobs that
 * fail this never reach any feed — "quality over quantity" enforced at ingest.
 */
export function isPublishable(job) {
  return (
    job.quality.score >= 40 &&
    !job.quality.flags.includes('missing_title') &&
    !job.quality.flags.includes('missing_apply_url')
  );
}

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
