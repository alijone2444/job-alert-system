import { chromium } from 'playwright';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Extract job ID from a LinkedIn job URL.
 */
function extractJobId(url) {
  if (!url) return null;
  const match = url.match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Scrape job cards from the LinkedIn search results page.
 */
async function scrapeJobCards(page) {
  return page.evaluate(() => {
    const cards = document.querySelectorAll(
      'div.job-search-card, li.jobs-search-results__list-item, div.base-card'
    );

    const results = [];

    cards.forEach((card) => {
      const titleEl =
        card.querySelector('.base-search-card__title') ||
        card.querySelector('h3.base-search-card__title') ||
        card.querySelector('a.job-card-list__title');

      const companyEl =
        card.querySelector('.base-search-card__subtitle') ||
        card.querySelector('h4.base-search-card__subtitle') ||
        card.querySelector('a.hidden-nested-link');

      const locationEl =
        card.querySelector('.job-search-card__location') ||
        card.querySelector('.base-search-card__metadata span');

      const linkEl =
        card.querySelector('a.base-card__full-link') ||
        card.querySelector('a.job-card-container__link') ||
        titleEl?.closest('a');

      const title = titleEl?.textContent?.trim() || '';
      const company = companyEl?.textContent?.trim() || '';
      const location = locationEl?.textContent?.trim() || '';
      const link = linkEl?.href?.split('?')[0] || '';

      if (title && link) {
        results.push({ title, company, location, link });
      }
    });

    return results;
  });
}

/**
 * Fetch jobs from LinkedIn using Playwright with injected li_at cookie.
 * @param {string} searchUrl
 * @param {string} liAtCookie
 * @param {string} keywordFilter
 * @returns {Promise<Array>}
 */
export async function fetchLinkedInJobs(searchUrl, liAtCookie, keywordFilter = '') {
  if (!searchUrl) {
    throw new Error('LINKEDIN_SEARCH_URL is not configured');
  }

  if (!liAtCookie) {
    throw new Error('LINKEDIN_LI_AT cookie is missing. Extract it from your browser and set it as a secret.');
  }

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
    });

    await context.addCookies([
      {
        name: 'li_at',
        value: liAtCookie,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      },
    ]);

    const page = await context.newPage();

    console.log('[LinkedIn] Navigating to job search URL...');
    const response = await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    if (!response || response.status() >= 400) {
      throw new Error(`LinkedIn returned HTTP ${response?.status() ?? 'unknown'}`);
    }

    // Wait for job cards or detect auth wall
    try {
      await page.waitForSelector(
        'div.job-search-card, li.jobs-search-results__list-item, div.base-card',
        { timeout: 30000 }
      );
    } catch {
      const pageText = await page.textContent('body');
      if (pageText?.toLowerCase().includes('sign in') || pageText?.toLowerCase().includes('authwall')) {
        throw new Error(
          'LinkedIn session cookie (li_at) appears invalid or expired. Re-extract the cookie from your browser.'
        );
      }
      console.warn('[LinkedIn] Job cards did not render in time; attempting scrape anyway');
    }

    // Scroll to load more results
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(1500);
    }

    const rawJobs = await scrapeJobCards(page);

    if (!rawJobs.length) {
      console.warn('[LinkedIn] No job cards found. Selectors may have changed or the search returned empty results.');
      return [];
    }

    const jobs = rawJobs
      .map((job) => {
        const jobId = extractJobId(job.link);
        if (!jobId) return null;

        return {
          id: `linkedin:${jobId}`,
          platform: 'LinkedIn',
          title: job.title,
          link: job.link,
          description: '',
          company: job.company,
          location: job.location,
          publishedAt: new Date().toISOString(),
        };
      })
      .filter(Boolean)
      .filter((job) => {
        if (!keywordFilter) return true;
        const haystack = `${job.title} ${job.company} ${job.location}`.toLowerCase();
        return haystack.includes(keywordFilter);
      });

    console.log(`[LinkedIn] Scraped ${jobs.length} job(s)`);
    return jobs;
  } catch (error) {
    throw new Error(`LinkedIn fetch failed: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
