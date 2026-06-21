import { chromium } from 'playwright';
import { compileKeywordQuery, matchesKeyword } from '../services/keywordFilter.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// LinkedIn's public "guest" jobs endpoint. It returns plain HTML job cards
// (the .base-card markup) without requiring an authenticated SPA render, which
// is far more reliable than scraping the logged-in /jobs/search page.
const GUEST_ENDPOINT =
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

const PAGE_SIZE = 25; // LinkedIn returns 25 cards per "start" page

// Map LinkedIn geoIds to a clean country label for the app's country filter.
const GEO_COUNTRY = {
  '101022442': 'Pakistan',
  '103644278': 'United States',
  '101165590': 'United Kingdom',
  '101174742': 'Canada',
  '101282230': 'Germany',
  '104305776': 'United Arab Emirates',
  '102713980': 'India',
};

/**
 * Extract the numeric job ID from a card's entity URN or job URL.
 * Guest URLs look like /jobs/view/<slug>-4012345678?... so the trailing
 * digits are the ID, not /jobs/view/<digits>.
 */
function extractJobId(url, entityUrn) {
  if (entityUrn) {
    const m = entityUrn.match(/(\d{4,})/);
    if (m) return m[1];
  }
  if (url) {
    let m = url.match(/\/jobs\/view\/(?:[^/?]*-)?(\d{4,})/);
    if (m) return m[1];
    m = url.match(/(\d{6,})/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Translate a regular LinkedIn jobs search URL into the guest API URL.
 * Carries over the meaningful filters (keywords, location, recency, etc.)
 * and forces sort-by-date so the newest postings come first.
 */
function buildGuestSearchUrl(searchUrl, start, opts = {}) {
  const { geoId = null, fTPR = null, sortBy = null } = opts;
  let out;
  try {
    const src = new URL(searchUrl);

    // Already a guest endpoint? Just adjust the start offset.
    if (src.pathname.includes('seeMoreJobPostings')) {
      out = src;
    } else {
      out = new URL(GUEST_ENDPOINT);
      const passthrough = [
        'keywords',
        'location',
        'geoId',
        'f_TPR', // time posted range, e.g. r3600 = last hour, r86400 = last 24h
        'f_WT', // work type: 1 on-site, 2 remote, 3 hybrid
        'f_E', // experience level
        'f_JT', // job type
        'f_C', // company
        'distance',
        'sortBy',
      ];
      for (const key of passthrough) {
        const value = src.searchParams.get(key);
        if (value) out.searchParams.set(key, value);
      }
    }
  } catch {
    // Not a valid URL — treat the whole thing as a keywords query.
    out = new URL(GUEST_ENDPOINT);
    out.searchParams.set('keywords', searchUrl);
  }

  // Restrict to a specific country by geoId (overrides any free-text location).
  if (geoId) {
    out.searchParams.set('geoId', geoId);
    out.searchParams.delete('location');
  }

  // App-controlled overrides (time posted range + sort).
  if (fTPR) out.searchParams.set('f_TPR', fTPR);
  if (sortBy) out.searchParams.set('sortBy', sortBy);

  if (!out.searchParams.get('sortBy')) out.searchParams.set('sortBy', 'DD'); // date, newest first
  out.searchParams.set('start', String(start));
  return out.toString();
}

/**
 * Parse the .base-card job cards from whatever HTML is currently loaded.
 */
async function scrapeJobCards(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll(
      'li, div.base-card, div.job-search-card'
    );
    const results = [];
    const seen = new Set();

    cards.forEach((card) => {
      const titleEl =
        card.querySelector('.base-search-card__title') ||
        card.querySelector('h3.base-search-card__title') ||
        card.querySelector('a.job-card-list__title');

      const companyEl =
        card.querySelector('.base-search-card__subtitle') ||
        card.querySelector('h4.base-search-card__subtitle a') ||
        card.querySelector('h4.base-search-card__subtitle') ||
        card.querySelector('a.hidden-nested-link');

      const locationEl =
        card.querySelector('.job-search-card__location') ||
        card.querySelector('.base-search-card__metadata span');

      const linkEl =
        card.querySelector('a.base-card__full-link') ||
        card.querySelector('a.job-card-container__link') ||
        titleEl?.closest('a');

      const timeEl = card.querySelector('time');

      const cardWithUrn =
        card.getAttribute?.('data-entity-urn') ? card : card.querySelector('[data-entity-urn]');
      const entityUrn = cardWithUrn?.getAttribute('data-entity-urn') || '';

      const title = titleEl?.textContent?.trim() || '';
      const company = companyEl?.textContent?.trim() || '';
      const location = locationEl?.textContent?.trim() || '';
      const link = linkEl?.href?.split('?')[0] || '';
      const postedAt = timeEl?.getAttribute('datetime') || '';

      if (!title || !link) return;

      const dedupeKey = entityUrn || link;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      results.push({ title, company, location, link, entityUrn, postedAt });
    });

    return results;
  });
}

/**
 * Fetch jobs from LinkedIn via the public guest jobs endpoint.
 *
 * NOTE: the guest endpoint must be hit UNAUTHENTICATED. Injecting an li_at
 * session cookie makes LinkedIn bounce between guest/authenticated URLs and
 * fail with ERR_TOO_MANY_REDIRECTS, so we deliberately do not send it here.
 *
 * @param {string} searchUrl   LinkedIn jobs search URL (or a raw keywords string)
 * @param {string} keywordFilter  optional boolean keyword query for client-side filtering
 * @param {number} maxJobs     cap on jobs to return
 * @param {string[]} geoIds    optional list of LinkedIn geoIds to restrict by country
 *                             (each searched separately and merged)
 * @returns {Promise<Array>}
 */
export async function fetchLinkedInJobs(
  searchUrl,
  keywordFilter = '',
  maxJobs = 50,
  geoIds = [],
  options = {}
) {
  if (!searchUrl) {
    throw new Error('LINKEDIN_SEARCH_URL is not configured');
  }

  const compiledFilter = compileKeywordQuery(keywordFilter);
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    const page = await context.newPage();
    const byId = new Map();

    // Search each country (geoId) separately and merge; [null] = no geo restriction.
    const targets = geoIds.length ? geoIds : [null];
    const pagesPerTarget = Math.min(Math.ceil(maxJobs / PAGE_SIZE) + 1, 4);

    for (const geoId of targets) {
      const country = geoId ? GEO_COUNTRY[geoId] || '' : '';
      const label = geoId ? `${country || geoId}` : 'global';

      for (let pageIndex = 0; pageIndex < pagesPerTarget; pageIndex++) {
        const url = buildGuestSearchUrl(searchUrl, pageIndex * PAGE_SIZE, {
          geoId,
          fTPR: options.fTPR,
          sortBy: options.sortBy,
        });
        console.log(`[LinkedIn] ${label} — page ${pageIndex + 1}/${pagesPerTarget}...`);

        let response;
        try {
          response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (error) {
          console.warn(`[LinkedIn] ${label} page ${pageIndex + 1} navigation failed: ${error.message}`);
          break;
        }

        const status = response?.status() ?? 0;
        if (status === 429) {
          console.warn('[LinkedIn] Rate limited (HTTP 429). Stopping this country.');
          break;
        }
        if (status >= 400) {
          console.warn(`[LinkedIn] ${label} page ${pageIndex + 1} returned HTTP ${status}. Stopping.`);
          break;
        }

        const rawJobs = await scrapeJobCards(page);
        if (!rawJobs.length) {
          console.log(`[LinkedIn] ${label} — no more cards at page ${pageIndex + 1}.`);
          break;
        }

        for (const job of rawJobs) {
          const jobId = extractJobId(job.link, job.entityUrn);
          if (!jobId || byId.has(jobId)) continue;

          byId.set(jobId, {
            id: `linkedin:${jobId}`,
            platform: 'LinkedIn',
            title: job.title,
            link: job.link,
            description: '',
            company: job.company,
            location: job.location,
            country,
            publishedAt: job.postedAt
              ? new Date(job.postedAt).toISOString()
              : new Date().toISOString(),
          });
        }

        await page.waitForTimeout(800); // be gentle between requests
      }
    }

    if (!byId.size) {
      console.warn(
        '[LinkedIn] No job cards found. The search may be empty, or LinkedIn changed its markup / rate-limited the request.'
      );
      return [];
    }

    const jobs = [...byId.values()].filter((job) => {
      const haystack = `${job.title} ${job.company} ${job.location}`;
      return matchesKeyword(haystack, compiledFilter);
    });

    console.log(
      `[LinkedIn] Scraped ${byId.size} job(s), ${jobs.length} after keyword filter`
    );
    return jobs.slice(0, maxJobs);
  } catch (error) {
    throw new Error(`LinkedIn fetch failed: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
