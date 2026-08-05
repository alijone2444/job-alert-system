/**
 * LinkedIn — public "guest" jobs endpoints. No login, no cookie, no browser.
 *
 * TWO endpoints are used, and the split matters:
 *
 *  1. SEARCH  /jobs-guest/jobs/api/seeMoreJobPostings/search
 *     Cheap, returns 25 cards per page. But a card only carries
 *     title / company / location / posted-time. No employment type, no
 *     seniority, no description, no skills — i.e. almost nothing the
 *     recommendation engine can score on.
 *
 *  2. DETAIL  /jobs-guest/jobs/api/jobPosting/<id>
 *     Returns the full posting: description text plus the
 *     "Seniority level / Employment type / Job function / Industries" block.
 *     This is what makes real personalisation possible.
 *
 * WHY detail runs as a separate `enrich` pass instead of inline: detail is one
 * request PER JOB. Fetching it for all ~100 search results every 2 minutes
 * would be ~72,000 requests/day and LinkedIn would 429 us within the hour. So
 * the pipeline dedupes FIRST and only enriches jobs that are genuinely new,
 * under a per-run budget. Typical cost: 0-12 detail requests per run.
 */

import * as cheerio from 'cheerio';
import { defineSource } from './Source.js';
import { getText, httpGet, delay, HttpError } from '../core/http.js';
import { createNormalizedJob } from '../core/normalizedJob.js';
import {
  COUNTRY_BY_ID,
  LINKEDIN_SENIORITY_MAP,
  detectCountry,
  detectJobType,
  detectLevel,
  detectSalary,
  detectSkills,
  detectWorkplace,
  toAnnualUsd,
} from '../core/taxonomy.js';

const SEARCH_ENDPOINT =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const DETAIL_ENDPOINT = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';

const PAGE_SIZE = 25;
const MAX_PAGES_PER_COUNTRY = 3;
const PAGE_DELAY_MS = 600;
const DETAIL_DELAY_MS = 450;

const GUEST_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'X-Requested-With': 'XMLHttpRequest',
};

/**
 * Broad discovery query. We intentionally cast wide here and let the
 * recommendation engine do the narrowing — a query tuned to one user's skills
 * would make the shared job pool useless for every other user.
 */
const DEFAULT_KEYWORDS =
  '("software engineer" OR "software developer" OR "web developer" OR ' +
  '"full stack" OR frontend OR backend OR "react native" OR react OR ' +
  '"node.js" OR javascript OR typescript OR python OR java OR ".net" OR ' +
  'flutter OR android OR ios OR devops OR "ai engineer" OR "machine learning")';

/* -------------------------------------------------------------------------- */
/*                                   SEARCH                                    */
/* -------------------------------------------------------------------------- */

function buildSearchUrl({ geoId, start, sinceSeconds, keywords }) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('keywords', keywords);
  if (geoId) url.searchParams.set('geoId', geoId);
  if (sinceSeconds) url.searchParams.set('f_TPR', `r${sinceSeconds}`);
  url.searchParams.set('sortBy', 'DD'); // date descending — freshest first
  url.searchParams.set('start', String(start));
  return url.toString();
}

/** Pull the numeric posting id out of a card's URN or href. */
function extractJobId(link, entityUrn) {
  const fromUrn = entityUrn?.match(/(\d{6,})/);
  if (fromUrn) return fromUrn[1];
  const fromLink = link?.match(/\/jobs\/view\/(?:[^/?]*-)?(\d{6,})/) || link?.match(/(\d{6,})/);
  return fromLink ? fromLink[1] : null;
}

function parseSearchCards(html) {
  const $ = cheerio.load(html);
  const cards = [];

  $('li, div.base-card, div.job-search-card').each((_, element) => {
    const card = $(element);
    const title = card.find('.base-search-card__title').first().text().trim();
    const company = card
      .find('.base-search-card__subtitle a, .base-search-card__subtitle, a.hidden-nested-link')
      .first()
      .text()
      .trim();
    const location = card.find('.job-search-card__location').first().text().trim();
    const href =
      card.find('a.base-card__full-link').attr('href') ||
      card.find('a.base-search-card__title-link').attr('href') ||
      card.find('a').attr('href') ||
      '';
    const entityUrn =
      card.attr('data-entity-urn') ||
      card.find('[data-entity-urn]').attr('data-entity-urn') ||
      '';
    const postedAt = card.find('time').attr('datetime') || '';

    if (title && href) {
      cards.push({ title, company, location, link: href.split('?')[0], entityUrn, postedAt });
    }
  });

  return cards;
}

async function fetchJobs(ctx) {
  const { limit, countries, sinceMs, budget, logger, config } = ctx;
  const keywords = config?.keywords || DEFAULT_KEYWORDS;
  const sinceSeconds = Math.max(3600, Math.round(sinceMs / 1000));

  // Map canonical country ids -> LinkedIn geoIds. Unknown/absent -> worldwide.
  const targets = countries.length
    ? countries.map((id) => COUNTRY_BY_ID.get(id)).filter((c) => c?.geoId)
    : [];
  const geoTargets = targets.length ? targets : [null];

  const byId = new Map();

  for (const target of geoTargets) {
    const label = target?.label || 'worldwide';

    for (let page = 0; page < MAX_PAGES_PER_COUNTRY; page++) {
      if (budget.expired(5_000)) {
        logger.warn('budget exhausted during search', { country: label, page });
        return finalize(byId, limit);
      }
      if (byId.size >= limit) return finalize(byId, limit);

      const url = buildSearchUrl({
        geoId: target?.geoId,
        start: page * PAGE_SIZE,
        sinceSeconds,
        keywords,
      });

      let html;
      try {
        html = await getText(url, { headers: GUEST_HEADERS, retries: 1 });
      } catch (error) {
        if (error instanceof HttpError && error.status === 429) {
          logger.warn('rate limited (429) — stopping this country', { country: label });
        } else {
          logger.warn('search page failed', { country: label, page, error: error.message });
        }
        break;
      }

      const cards = parseSearchCards(html);
      logger.debug('search page parsed', { country: label, page: page + 1, cards: cards.length });
      if (!cards.length) break;

      for (const card of cards) {
        const sourceJobId = extractJobId(card.link, card.entityUrn);
        if (!sourceJobId || byId.has(sourceJobId)) continue;

        // Country from the geo we queried, else inferred from the location text.
        const country = target?.id || detectCountry(card.location) || null;
        // Card text is thin, but title + location still carry real signal.
        const cardText = `${card.title} ${card.location}`;

        byId.set(
          sourceJobId,
          createNormalizedJob({
            sourceId: 'linkedin',
            sourceJobId,
            title: card.title,
            company: card.company,
            location: card.location,
            country,
            workplace: detectWorkplace(cardText),
            jobType: detectJobType(card.title),
            experienceLevel: detectLevel(card.title),
            skills: detectSkills(card.title),
            description: '',
            applyUrl: card.link,
            postedAt: card.postedAt || new Date().toISOString(),
            enriched: false,
          })
        );
      }

      await delay(PAGE_DELAY_MS);
    }
  }

  return finalize(byId, limit);
}

function finalize(byId, limit) {
  return [...byId.values()].slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/*                              DETAIL ENRICHMENT                              */
/* -------------------------------------------------------------------------- */

/**
 * Parse the "Seniority level / Employment type / ..." criteria list plus the
 * description body out of a detail page.
 */
function parseDetail(html) {
  const $ = cheerio.load(html);

  const criteria = {};
  $('.description__job-criteria-item').each((_, element) => {
    const item = $(element);
    const key = item.find('.description__job-criteria-subheader').text().trim().toLowerCase();
    const value = item.find('.description__job-criteria-text').text().trim();
    if (key && value) criteria[key] = value;
  });

  const description = $('.description__text, .show-more-less-html__markup')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim();

  return { criteria, description };
}

/** LinkedIn's "Employment type" values map cleanly onto our canonical types. */
function mapEmploymentType(value) {
  return detectJobType(value || '');
}

function mapSeniority(value) {
  if (!value) return null;
  return LINKEDIN_SENIORITY_MAP[value.trim().toLowerCase()] ?? null;
}

/**
 * Second pass: fill in the metadata the search cards could not provide.
 * Mutates the given jobs in place and returns how many were enriched.
 *
 * @param {import('../core/normalizedJob.js').NormalizedJob[]} jobs
 * @param {import('./Source.js').FetchContext & {maxDetail:number}} ctx
 */
async function enrich(jobs, ctx) {
  const { budget, logger, maxDetail = 12 } = ctx;
  let enrichedCount = 0;

  const pending = jobs.filter((job) => job.sourceId === 'linkedin' && !job.enriched);
  const batch = pending.slice(0, maxDetail);

  if (pending.length > batch.length) {
    logger.info('detail budget reached — remaining jobs will enrich on a later run', {
      pending: pending.length,
      thisRun: batch.length,
    });
  }

  for (const job of batch) {
    if (budget.expired(4_000)) {
      logger.warn('budget exhausted during enrichment', { enriched: enrichedCount });
      break;
    }

    try {
      const response = await httpGet(`${DETAIL_ENDPOINT}/${job.sourceJobId}`, {
        headers: GUEST_HEADERS,
        retries: 0, // a failed detail is not worth a retry; next run picks it up
        timeoutMs: 8_000,
      });
      const { criteria, description } = parseDetail(await response.text());

      const fullText = `${job.title} ${job.location} ${description}`;

      job.description = description.slice(0, 4000);
      job.jobType = mapEmploymentType(criteria['employment type']) || job.jobType || detectJobType(fullText);
      job.experienceLevel =
        mapSeniority(criteria['seniority level']) || job.experienceLevel || detectLevel(job.title);
      job.workplace = job.workplace || detectWorkplace(fullText);
      job.skills = [...new Set([...job.skills, ...detectSkills(fullText)])];

      const salary = detectSalary(description);
      if (salary) {
        job.salary = salary;
        job.salaryAnnualUsd = toAnnualUsd(salary);
      }

      job.enriched = true;
      enrichedCount++;
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        logger.warn('detail rate limited — aborting enrichment for this run');
        break;
      }
      logger.debug('detail fetch failed', { jobId: job.sourceJobId, error: error.message });
    }

    await delay(DETAIL_DELAY_MS);
  }

  return enrichedCount;
}

export default defineSource({
  id: 'linkedin',
  label: 'LinkedIn',
  homepage: 'https://www.linkedin.com/jobs',
  capabilities: {
    description: true, // via the enrich pass
    salary: false, // LinkedIn guest pages almost never expose pay
    jobType: true,
    workplace: true,
    level: true,
    countryQuery: true,
  },
  fetchJobs,
  enrich,
});
