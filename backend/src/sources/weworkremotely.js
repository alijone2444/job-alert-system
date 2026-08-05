/**
 * We Work Remotely — public RSS feeds per category (free, key-less).
 *
 * Their item title packs two fields into one string: "Company: Job Title".
 * There is no structured company field anywhere in the feed, so splitting on
 * the first colon is the only option — with a guard, because some titles
 * legitimately contain a colon ("Engineer: Platform").
 */

import Parser from 'rss-parser';
import { defineSource } from './Source.js';
import { createNormalizedJob } from '../core/normalizedJob.js';
import { toPlainText } from '../core/text.js';
import { DESKTOP_USER_AGENT } from '../core/http.js';
import {
  COUNTRY_WORLDWIDE,
  WORKPLACE,
  detectCountry,
  detectJobType,
  detectLevel,
  detectSalary,
  detectSkills,
  toAnnualUsd,
} from '../core/taxonomy.js';

const FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
];

const parser = new Parser({
  timeout: 12_000,
  headers: { 'User-Agent': DESKTOP_USER_AGENT },
});

/** "Stripe: Backend Engineer, AI Security" -> { company, title } */
function splitTitle(raw) {
  const text = String(raw || '').trim();
  const index = text.indexOf(':');
  // A colon past ~40 chars is almost certainly part of the role, not a company.
  if (index > 0 && index <= 40) {
    return { company: text.slice(0, index).trim(), title: text.slice(index + 1).trim() };
  }
  return { company: '', title: text };
}

async function fetchJobs(ctx) {
  const { limit, sinceMs, budget, logger } = ctx;
  const cutoff = Date.now() - sinceMs;
  const seen = new Set();
  const jobs = [];

  for (const feedUrl of FEEDS) {
    if (budget.expired(4_000) || jobs.length >= limit) break;

    let feed;
    try {
      feed = await parser.parseURL(feedUrl);
    } catch (error) {
      logger.debug('feed failed', { feedUrl, error: error.message });
      continue;
    }

    for (const item of feed.items || []) {
      if (jobs.length >= limit) break;

      const link = item.link || item.guid;
      if (!link || seen.has(link)) continue;

      const postedAt = item.isoDate || item.pubDate;
      if (!postedAt || new Date(postedAt).getTime() < cutoff) continue;
      seen.add(link);

      const { company, title } = splitTitle(item.title);
      const description = toPlainText(item.contentSnippet || item.content);
      const fullText = `${title} ${description}`;
      const salary = detectSalary(description);

      jobs.push(
        createNormalizedJob({
          sourceId: 'weworkremotely',
          sourceJobId: link.split('/').pop() || link,
          title,
          company,
          location: 'Remote',
          // WWR lists a "Headquarters:" line; use it when it names a country.
          country: detectCountry(description.slice(0, 200)) || COUNTRY_WORLDWIDE,
          workplace: WORKPLACE.REMOTE,
          jobType: detectJobType(fullText),
          experienceLevel: detectLevel(title) || detectLevel(description.slice(0, 300)),
          skills: detectSkills(fullText),
          salary,
          salaryAnnualUsd: toAnnualUsd(salary),
          description,
          applyUrl: link,
          postedAt,
          enriched: true,
        })
      );
    }
  }

  logger.debug('scanned', { feeds: FEEDS.length, fresh: jobs.length });
  return jobs;
}

export default defineSource({
  id: 'weworkremotely',
  label: 'We Work Remotely',
  homepage: 'https://weworkremotely.com',
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
