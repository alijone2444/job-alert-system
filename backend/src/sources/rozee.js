/**
 * Rozee.pk — Pakistan's largest job board.
 *
 * STATUS: implemented, but DISABLED unless a scraping proxy is configured.
 *
 * Rozee sits behind Cloudflare bot protection. A direct request from Vercel
 * (or any datacenter IP) returns `HTTP 403 — Just a moment…`, verified by
 * probe. Defeating that requires a real browser + residential IP + JS
 * challenge solving, none of which is possible inside a serverless function.
 *
 * So the parser is written and tested-ready, and the network call is routed
 * through a pluggable proxy. Set ONE env var to turn the source on:
 *
 *   SCRAPER_PROXY_URL=https://api.scrapingbee.com/api/v1?api_key=KEY&url={url}
 *   SCRAPER_PROXY_URL=https://api.scraperapi.com?api_key=KEY&url={url}
 *
 * `{url}` is replaced with the URL-encoded target. Any provider with that
 * shape works — no code change needed.
 */

import * as cheerio from 'cheerio';
import { defineSource } from './Source.js';
import { getText } from '../core/http.js';
import { createNormalizedJob } from '../core/normalizedJob.js';
import { toPlainText } from '../core/text.js';
import {
  detectJobType,
  detectLevel,
  detectSalary,
  detectSkills,
  detectWorkplace,
  toAnnualUsd,
} from '../core/taxonomy.js';

const BASE = 'https://www.rozee.pk';
const SEARCH_QUERIES = ['software-engineer', 'react-developer', 'nodejs-developer', 'php-developer'];

/** Route a URL through the configured scraping proxy, if any. */
function proxied(targetUrl) {
  const template = process.env.SCRAPER_PROXY_URL;
  if (!template) return targetUrl;
  return template.includes('{url}')
    ? template.replace('{url}', encodeURIComponent(targetUrl))
    : `${template}${encodeURIComponent(targetUrl)}`;
}

const isConfigured = () => Boolean(process.env.SCRAPER_PROXY_URL);

/**
 * Parse Rozee's search-result list. Their markup uses `.job` cards with
 * `h3.s-18 > a` for the title/link and `.jobs-detail` for the meta line.
 */
function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('div.job, div.jobs-listing .job-listing').each((_, element) => {
    const card = $(element);
    const anchor = card.find('h3 a, h2 a').first();
    const title = anchor.text().trim();
    const href = anchor.attr('href') || '';
    if (!title || !href) return;

    results.push({
      title,
      link: href.startsWith('http') ? href : `${BASE}${href}`,
      company: card.find('.company a, .cname a, bdi').first().text().trim(),
      location: card.find('.jobs-detail .location, .job-location').first().text().trim(),
      postedAt: card.find('.job-date, time').first().text().trim(),
      snippet: card.find('.jobDetail, .job-description').first().text().trim(),
    });
  });

  return results;
}

/** Rozee prints relative dates ("2 days ago"); turn those into timestamps. */
function parseRelativeDate(text) {
  const match = String(text || '').match(/(\d+)\s*(minute|hour|day|week|month)/i);
  if (!match) return new Date().toISOString();
  const amount = Number(match[1]);
  const unitMs = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
  }[match[2].toLowerCase()];
  return new Date(Date.now() - amount * unitMs).toISOString();
}

async function fetchJobs(ctx) {
  const { limit, sinceMs, budget, logger } = ctx;

  if (!isConfigured()) {
    logger.info('skipped — SCRAPER_PROXY_URL not set (Rozee is Cloudflare-protected)');
    return [];
  }

  const cutoff = Date.now() - sinceMs;
  const jobs = [];

  for (const query of SEARCH_QUERIES) {
    if (budget.expired(6_000) || jobs.length >= limit) break;

    let html;
    try {
      html = await getText(proxied(`${BASE}/job/jsearch/q/${query}`), { timeoutMs: 25_000 });
    } catch (error) {
      logger.warn('search failed', { query, error: error.message });
      continue;
    }

    for (const card of parseSearchResults(html)) {
      if (jobs.length >= limit) break;

      const postedAt = parseRelativeDate(card.postedAt);
      if (new Date(postedAt).getTime() < cutoff) continue;

      const description = toPlainText(card.snippet);
      const fullText = `${card.title} ${card.location} ${description}`;
      const salary = detectSalary(description);

      jobs.push(
        createNormalizedJob({
          sourceId: 'rozee',
          sourceJobId: card.link.split('/').pop() || card.link,
          title: card.title,
          company: card.company,
          location: card.location,
          country: 'PK', // Rozee is a Pakistan-only board
          workplace: detectWorkplace(fullText),
          jobType: detectJobType(fullText),
          experienceLevel: detectLevel(card.title) || detectLevel(description.slice(0, 300)),
          skills: detectSkills(fullText),
          salary,
          salaryAnnualUsd: toAnnualUsd(salary),
          description,
          applyUrl: card.link,
          postedAt,
          enriched: true,
        })
      );
    }
  }

  logger.debug('scanned', { fresh: jobs.length });
  return jobs;
}

export default defineSource({
  id: 'rozee',
  label: 'Rozee.pk',
  homepage: 'https://www.rozee.pk',
  // Evaluated at module load — env is fixed for the lifetime of a process.
  available: isConfigured(),
  unavailableReason:
    'Cloudflare bot protection blocks datacenter IPs (verified HTTP 403). Set SCRAPER_PROXY_URL to enable.',
  capabilities: {
    description: true,
    salary: true,
    jobType: true,
    workplace: true,
    level: true,
    countryQuery: true,
  },
  fetchJobs,
});
