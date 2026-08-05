/**
 * Ashby — public job-board API.
 *
 * Endpoint: https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true
 *
 * Ashby is the ONLY free source here that returns genuinely structured
 * compensation, plus `employmentType`, `workplaceType`, `isRemote` and a
 * postal address with a country. That makes it the highest-signal adapter, so
 * we trust its fields over any text inference.
 */

import { defineSource } from './Source.js';
import { getJson } from '../core/http.js';
import { createNormalizedJob } from '../core/normalizedJob.js';
import { toPlainText } from '../core/text.js';
import { getBoards, rotateBoards } from './companyBoards.js';
import {
  JOB_TYPE,
  WORKPLACE,
  detectCountry,
  detectLevel,
  detectSkills,
  toAnnualUsd,
} from '../core/taxonomy.js';

const API = 'https://api.ashbyhq.com/posting-api/job-board';
const BOARDS_PER_RUN = 3;

const EMPLOYMENT_MAP = {
  fulltime: JOB_TYPE.FULL_TIME,
  parttime: JOB_TYPE.PART_TIME,
  intern: JOB_TYPE.INTERNSHIP,
  contract: JOB_TYPE.CONTRACT,
  temporary: JOB_TYPE.CONTRACT,
};

const WORKPLACE_MAP = {
  remote: WORKPLACE.REMOTE,
  hybrid: WORKPLACE.HYBRID,
  onsite: WORKPLACE.ONSITE,
  'on-site': WORKPLACE.ONSITE,
};

/**
 * Ashby compensation is a tiered structure; we take the first salary-like tier.
 * Shape: { compensationTiers: [{ components: [{ minValue, maxValue, currencyCode,
 *          interval, compensationType }] }] }
 */
function extractCompensation(compensation) {
  const tiers = compensation?.compensationTiers;
  if (!Array.isArray(tiers)) return null;

  for (const tier of tiers) {
    for (const component of tier?.components || []) {
      const isSalary = String(component?.compensationType || '').toLowerCase() === 'salary';
      const min = Number(component?.minValue);
      const max = Number(component?.maxValue);
      if (!isSalary || (!Number.isFinite(min) && !Number.isFinite(max))) continue;

      const interval = String(component?.interval || '').toUpperCase();
      const period = interval.includes('HOUR') ? 'hour' : interval.includes('MONTH') ? 'month' : 'year';

      return {
        min: Number.isFinite(min) ? Math.round(min) : null,
        max: Number.isFinite(max) ? Math.round(max) : null,
        currency: component.currencyCode || 'USD',
        period,
      };
    }
  }
  return null;
}

function resolveCountry(raw) {
  const fromAddress = raw?.address?.postalAddress?.addressCountry;
  const detected = detectCountry(fromAddress || '') || detectCountry(raw?.location || '');
  return detected || null;
}

async function fetchJobs(ctx) {
  const { limit, sinceMs, budget, logger } = ctx;
  const boards = rotateBoards(getBoards('ashby'), BOARDS_PER_RUN);
  const cutoff = Date.now() - sinceMs;
  const jobs = [];

  for (const slug of boards) {
    if (budget.expired(5_000) || jobs.length >= limit) break;

    let payload;
    try {
      payload = await getJson(`${API}/${slug}?includeCompensation=true`, { timeoutMs: 15_000 });
    } catch (error) {
      logger.debug('board unavailable', { slug, error: error.message });
      continue;
    }

    const boardJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    let kept = 0;

    for (const raw of boardJobs) {
      if (jobs.length >= limit) break;
      if (raw?.isListed === false) continue;
      if (!raw?.publishedAt || new Date(raw.publishedAt).getTime() < cutoff) continue;

      const description = toPlainText(raw.descriptionPlain || raw.descriptionHtml);
      const title = String(raw.title || '').trim();
      const fullText = `${title} ${raw.location || ''} ${description}`;

      const workplace =
        WORKPLACE_MAP[String(raw.workplaceType || '').toLowerCase()] ??
        (raw.isRemote ? WORKPLACE.REMOTE : null);

      const salary = extractCompensation(raw.compensation);

      jobs.push(
        createNormalizedJob({
          sourceId: 'ashby',
          sourceJobId: raw.id,
          title,
          company: titleCase(slug),
          location: raw.location || '',
          country: resolveCountry(raw),
          workplace,
          jobType: EMPLOYMENT_MAP[String(raw.employmentType || '').toLowerCase()] ?? null,
          experienceLevel: detectLevel(title) || detectLevel(description.slice(0, 300)),
          skills: detectSkills(fullText),
          salary,
          salaryAnnualUsd: toAnnualUsd(salary),
          description,
          applyUrl: raw.jobUrl || raw.applyUrl,
          postedAt: raw.publishedAt,
          enriched: true,
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
  id: 'ashby',
  label: 'Ashby',
  homepage: 'https://www.ashbyhq.com',
  capabilities: {
    description: true,
    salary: true, // genuinely structured
    jobType: true,
    workplace: true,
    level: true,
    countryQuery: false,
  },
  fetchJobs,
});
