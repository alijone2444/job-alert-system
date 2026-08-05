/**
 * Lever — public postings API.
 *
 * Endpoint: https://api.lever.co/v0/postings/<slug>?mode=json
 *
 * Lever is the richest of the free ATS feeds: it returns a real ISO-2 `country`
 * and a real `workplaceType` (remote/hybrid/on-site), so unlike Greenhouse we
 * do NOT have to guess those from prose. `categories.commitment` gives the
 * employment type ("Full-time", "Permanent", "Intern", "Contract").
 */

import { defineSource } from './Source.js';
import { getJson } from '../core/http.js';
import { createNormalizedJob } from '../core/normalizedJob.js';
import { toPlainText } from '../core/text.js';
import { getBoards, rotateBoards } from './companyBoards.js';
import {
  COUNTRY_BY_ID,
  WORKPLACE,
  detectCountry,
  detectJobType,
  detectLevel,
  detectSalary,
  detectSkills,
  detectWorkplace,
  toAnnualUsd,
} from '../core/taxonomy.js';

const API = 'https://api.lever.co/v0/postings';
const BOARDS_PER_RUN = 2;

/** Lever's workplaceType values map 1:1 onto ours. */
const WORKPLACE_MAP = {
  remote: WORKPLACE.REMOTE,
  hybrid: WORKPLACE.HYBRID,
  'on-site': WORKPLACE.ONSITE,
  onsite: WORKPLACE.ONSITE,
  unspecified: null,
};

async function fetchJobs(ctx) {
  const { limit, sinceMs, budget, logger } = ctx;
  const boards = rotateBoards(getBoards('lever'), BOARDS_PER_RUN);
  const cutoff = Date.now() - sinceMs;
  const jobs = [];

  for (const slug of boards) {
    if (budget.expired(5_000) || jobs.length >= limit) break;

    let postings;
    try {
      postings = await getJson(`${API}/${slug}?mode=json`, { timeoutMs: 15_000 });
    } catch (error) {
      // 404 just means the slug moved or the board closed — not worth an error.
      logger.debug('board unavailable', { slug, error: error.message });
      continue;
    }

    if (!Array.isArray(postings)) continue;
    let kept = 0;

    for (const raw of postings) {
      if (jobs.length >= limit) break;
      if (!raw?.createdAt || raw.createdAt < cutoff) continue;

      const description = toPlainText(
        raw.descriptionPlain || raw.descriptionBodyPlain || raw.description
      );
      const location = raw.categories?.location || '';
      const title = raw.text || '';
      const fullText = `${title} ${location} ${description}`;

      // Lever's ISO-2 country is authoritative; fall back to text detection.
      const country = COUNTRY_BY_ID.has(raw.country)
        ? raw.country
        : detectCountry(location) || null;

      const salary = detectSalary(description);

      jobs.push(
        createNormalizedJob({
          sourceId: 'lever',
          sourceJobId: raw.id,
          title,
          company: titleCase(slug),
          location,
          country,
          workplace:
            WORKPLACE_MAP[String(raw.workplaceType || '').toLowerCase()] ??
            detectWorkplace(`${location} ${description}`),
          jobType: detectJobType(raw.categories?.commitment || '') || detectJobType(fullText),
          experienceLevel: detectLevel(title) || detectLevel(description.slice(0, 300)),
          skills: detectSkills(fullText),
          salary,
          salaryAnnualUsd: toAnnualUsd(salary),
          description,
          applyUrl: raw.hostedUrl || raw.applyUrl,
          postedAt: new Date(raw.createdAt).toISOString(),
          enriched: true,
        })
      );
      kept++;
    }

    logger.debug('board scanned', { slug, total: postings.length, fresh: kept });
  }

  return jobs;
}

function titleCase(slug) {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default defineSource({
  id: 'lever',
  label: 'Lever',
  homepage: 'https://www.lever.co',
  capabilities: {
    description: true,
    salary: true,
    jobType: true,
    workplace: true, // structured, not inferred
    level: true,
    countryQuery: false,
  },
  fetchJobs,
});
