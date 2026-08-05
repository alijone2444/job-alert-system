/**
 * Greenhouse — the job board behind a large share of tech career pages.
 *
 * Endpoint: https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
 * Public, key-less, stable. `content=true` returns the full posting body, which
 * is where every skill / workplace / salary signal lives (Greenhouse exposes no
 * structured fields for those, so we extract from prose).
 *
 * NOTE: `content` is HTML-entity-escaped HTML — see core/text.js.
 */

import { defineSource } from './Source.js';
import { getJson } from '../core/http.js';
import { createNormalizedJob } from '../core/normalizedJob.js';
import { toPlainText } from '../core/text.js';
import { getBoards, rotateBoards } from './companyBoards.js';
import {
  detectCountry,
  detectJobType,
  detectLevel,
  detectSalary,
  detectSkills,
  detectWorkplace,
  toAnnualUsd,
} from '../core/taxonomy.js';

const API = 'https://boards-api.greenhouse.io/v1/boards';
const BOARDS_PER_RUN = 2;

async function fetchJobs(ctx) {
  const { limit, sinceMs, budget, logger } = ctx;
  const boards = rotateBoards(getBoards('greenhouse'), BOARDS_PER_RUN);
  const cutoff = Date.now() - sinceMs;
  const jobs = [];

  for (const slug of boards) {
    if (budget.expired(5_000) || jobs.length >= limit) break;

    let payload;
    try {
      payload = await getJson(`${API}/${slug}/jobs?content=true`, { timeoutMs: 15_000 });
    } catch (error) {
      logger.warn('board fetch failed', { slug, error: error.message });
      continue;
    }

    const boardJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    let kept = 0;

    for (const raw of boardJobs) {
      if (jobs.length >= limit) break;

      // Greenhouse has no "posted recently" query param, so filter client-side.
      const postedAt = raw.first_published || raw.updated_at;
      if (!postedAt || new Date(postedAt).getTime() < cutoff) continue;

      const description = toPlainText(raw.content);
      const location = raw.location?.name || '';
      const fullText = `${raw.title} ${location} ${description}`;
      const salary = detectSalary(description);

      jobs.push(
        createNormalizedJob({
          sourceId: 'greenhouse',
          sourceJobId: String(raw.id),
          title: raw.title,
          company: raw.company_name || titleCase(slug),
          location,
          country: detectCountry(location) || detectCountry(description),
          workplace: detectWorkplace(`${location} ${description}`),
          jobType: detectJobType(fullText),
          experienceLevel: detectLevel(raw.title) || detectLevel(description.slice(0, 300)),
          skills: detectSkills(fullText),
          salary,
          salaryAnnualUsd: toAnnualUsd(salary),
          description,
          applyUrl: raw.absolute_url,
          postedAt,
          enriched: true, // content=true already gives us everything available
        })
      );
      kept++;
    }

    logger.debug('board scanned', { slug, total: boardJobs.length, fresh: kept });
  }

  return jobs;
}

function titleCase(slug) {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default defineSource({
  id: 'greenhouse',
  label: 'Greenhouse',
  homepage: 'https://www.greenhouse.io',
  capabilities: {
    description: true,
    salary: true, // extracted from prose, not structured
    jobType: true,
    workplace: true,
    level: true,
    countryQuery: false,
  },
  fetchJobs,
});
