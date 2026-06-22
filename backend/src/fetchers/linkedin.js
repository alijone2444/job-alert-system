import * as cheerio from 'cheerio';
import { compileKeywordQuery, matchesKeyword } from '../services/keywordFilter.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// LinkedIn's public "guest" jobs endpoint returns plain HTML job cards — no
// login and (importantly) no browser needed, so a simple fetch + cheerio parse
// works. This makes the whole thing lightweight enough for any host / serverless.
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
 */
function buildGuestSearchUrl(searchUrl, start, opts = {}) {
  const { geoId = null, fTPR = null, sortBy = null } = opts;
  let out;
  try {
    const src = new URL(searchUrl);
    if (src.pathname.includes('seeMoreJobPostings')) {
      out = src;
    } else {
      out = new URL(GUEST_ENDPOINT);
      const passthrough = [
        'keywords',
        'location',
        'geoId',
        'f_TPR',
        'f_WT',
        'f_E',
        'f_JT',
        'f_C',
        'distance',
        'sortBy',
      ];
      for (const key of passthrough) {
        const value = src.searchParams.get(key);
        if (value) out.searchParams.set(key, value);
      }
    }
  } catch {
    out = new URL(GUEST_ENDPOINT);
    out.searchParams.set('keywords', searchUrl);
  }

  if (geoId) {
    out.searchParams.set('geoId', geoId);
    out.searchParams.delete('location');
  }
  if (fTPR) out.searchParams.set('f_TPR', fTPR);
  if (sortBy) out.searchParams.set('sortBy', sortBy);
  if (!out.searchParams.get('sortBy')) out.searchParams.set('sortBy', 'DD');
  out.searchParams.set('start', String(start));
  return out.toString();
}

/**
 * Parse the .base-card job cards out of a guest-endpoint HTML fragment.
 */
function parseJobCards(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('li, div.base-card, div.job-search-card').each((_, el) => {
    const card = $(el);

    const title = card.find('.base-search-card__title').first().text().trim();
    const company = card
      .find('.base-search-card__subtitle a, .base-search-card__subtitle, a.hidden-nested-link')
      .first()
      .text()
      .trim();
    const location = card.find('.job-search-card__location').first().text().trim();
    const linkRaw =
      card.find('a.base-card__full-link').attr('href') ||
      card.find('a.base-search-card__title-link').attr('href') ||
      card.find('a').attr('href') ||
      '';
    const link = linkRaw.split('?')[0];
    const entityUrn =
      card.attr('data-entity-urn') || card.find('[data-entity-urn]').attr('data-entity-urn') || '';
    const postedAt = card.find('time').attr('datetime') || '';

    if (title && link) {
      results.push({ title, company, location, link, entityUrn, postedAt });
    }
  });

  return results;
}

async function fetchGuestPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  return res;
}

/**
 * Fetch jobs from LinkedIn via the public guest jobs endpoint (no browser).
 * @param {string} searchUrl
 * @param {string} keywordFilter   optional boolean keyword query (client-side)
 * @param {number} maxJobs
 * @param {string[]} geoIds        countries to search (each merged); [] = global
 * @param {{fTPR?:string, sortBy?:string}} options
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
  const byId = new Map();

  const targets = geoIds.length ? geoIds : [null];
  const pagesPerTarget = Math.min(Math.ceil(maxJobs / PAGE_SIZE) + 1, 4);

  for (const geoId of targets) {
    const country = geoId ? GEO_COUNTRY[geoId] || '' : '';
    const label = geoId ? country || geoId : 'global';

    for (let pageIndex = 0; pageIndex < pagesPerTarget; pageIndex++) {
      const url = buildGuestSearchUrl(searchUrl, pageIndex * PAGE_SIZE, {
        geoId,
        fTPR: options.fTPR,
        sortBy: options.sortBy,
      });

      let res;
      try {
        res = await fetchGuestPage(url);
      } catch (error) {
        console.warn(`[LinkedIn] ${label} page ${pageIndex + 1} fetch failed: ${error.message}`);
        break;
      }

      if (res.status === 429) {
        console.warn('[LinkedIn] Rate limited (429). Stopping this country.');
        break;
      }
      if (!res.ok) {
        console.warn(`[LinkedIn] ${label} page ${pageIndex + 1} HTTP ${res.status}. Stopping.`);
        break;
      }

      const html = await res.text();
      const rawJobs = parseJobCards(html);
      console.log(`[LinkedIn] ${label} — page ${pageIndex + 1}: ${rawJobs.length} card(s)`);
      if (!rawJobs.length) break;

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
          publishedAt: job.postedAt ? new Date(job.postedAt).toISOString() : new Date().toISOString(),
        });
      }

      // be gentle between requests
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  if (!byId.size) {
    console.warn('[LinkedIn] No job cards found (empty search or rate-limited).');
    return [];
  }

  // Filter on the TITLE only — keeps the include/exclude precise (e.g. "Game"
  // in a company name shouldn't drop an otherwise-relevant job).
  const jobs = [...byId.values()].filter((job) => matchesKeyword(job.title, compiledFilter));
  console.log(`[LinkedIn] Scraped ${byId.size} job(s), ${jobs.length} after keyword filter`);
  return jobs.slice(0, maxJobs);
}
