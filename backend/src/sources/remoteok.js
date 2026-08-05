/**
 * RemoteOK — https://remoteok.com/api (free, key-less, single JSON array).
 *
 * ToS NOTE: RemoteOK's API terms require attribution with a followable link
 * back to the posting. We satisfy this by (a) storing their URL as the
 * `applyUrl` — taps open remoteok.com directly — and (b) declaring
 * `attribution`, which the app renders on the source badge. Do not strip it.
 *
 * Every RemoteOK job is by definition remote, and `salary_min`/`salary_max` are
 * already annual USD (0 means unknown, NOT zero pay).
 */

import { defineSource } from './Source.js';
import { getJson } from '../core/http.js';
import { createNormalizedJob } from '../core/normalizedJob.js';
import { toPlainText } from '../core/text.js';
import { COUNTRY_WORLDWIDE, WORKPLACE, detectCountry, detectJobType, detectLevel, detectSkills } from '../core/taxonomy.js';

const API = 'https://remoteok.com/api';

/**
 * RemoteOK tags are free-form but reasonably canonical ("react", "node",
 * "typescript"). Feeding them through the same detector keeps skill ids
 * consistent with every other source.
 */
function skillsFromTags(tags) {
  if (!Array.isArray(tags)) return [];
  return detectSkills(tags.join(' , '));
}

async function fetchJobs(ctx) {
  const { limit, sinceMs, logger } = ctx;
  const cutoffEpoch = Math.floor((Date.now() - sinceMs) / 1000);

  const payload = await getJson(API, { timeoutMs: 15_000, retries: 1 });
  if (!Array.isArray(payload)) throw new Error('unexpected RemoteOK payload');

  // The first element is a legal/ToS notice, not a job.
  const rows = payload.filter((row) => row && row.id && row.position);
  const jobs = [];

  for (const raw of rows) {
    if (jobs.length >= limit) break;

    const epoch = Number(raw.epoch) || (raw.date ? Math.floor(new Date(raw.date).getTime() / 1000) : 0);
    if (!epoch || epoch < cutoffEpoch) continue;

    const description = toPlainText(raw.description);
    const title = String(raw.position).trim();
    const tagText = Array.isArray(raw.tags) ? raw.tags.join(' ') : '';
    const fullText = `${title} ${tagText} ${description}`;

    const min = Number(raw.salary_min) || null;
    const max = Number(raw.salary_max) || null;
    const salary = min || max ? { min, max, currency: 'USD', period: 'year' } : null;

    jobs.push(
      createNormalizedJob({
        sourceId: 'remoteok',
        sourceJobId: String(raw.id),
        title,
        company: raw.company || '',
        location: raw.location || 'Remote',
        // Remote boards are geography-free unless the listing names a country.
        country: detectCountry(raw.location || '') || COUNTRY_WORLDWIDE,
        workplace: WORKPLACE.REMOTE,
        jobType: detectJobType(fullText),
        experienceLevel: detectLevel(title) || detectLevel(description.slice(0, 300)),
        skills: [...new Set([...skillsFromTags(raw.tags), ...detectSkills(fullText)])],
        salary,
        salaryAnnualUsd: max || min || null,
        description,
        applyUrl: raw.url || raw.apply_url,
        postedAt: new Date(epoch * 1000).toISOString(),
        enriched: true,
      })
    );
  }

  logger.debug('scanned', { total: rows.length, fresh: jobs.length });
  return jobs;
}

export default defineSource({
  id: 'remoteok',
  label: 'RemoteOK',
  homepage: 'https://remoteok.com',
  attribution: 'Jobs by RemoteOK',
  capabilities: {
    description: true,
    salary: true,
    jobType: true,
    workplace: true,
    level: true,
    countryQuery: false,
  },
  fetchJobs,
});
