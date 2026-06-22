import { compileKeywordQuery, matchesKeyword } from '../services/keywordFilter.js';

// Remotive's free, no-key JSON endpoint for remote jobs. Same spirit as the
// LinkedIn guest endpoint: just fetch + parse, no API key, no limits.
const ENDPOINT = 'https://remotive.com/api/remote-jobs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Fetch remote dev jobs from Remotive. Runs a few searches across the user's
 * primary stack and merges, then applies the same title keyword filter.
 * @param {string} keywordFilter  boolean title filter
 * @param {number} maxJobs
 * @returns {Promise<Array>}
 */
export async function fetchRemotiveJobs(keywordFilter = '', maxJobs = 50) {
  const compiled = compileKeywordQuery(keywordFilter);
  const searches = ['react', 'node', 'full stack', '.net', 'react native'];
  const byId = new Map();

  for (const term of searches) {
    const url = `${ENDPOINT}?search=${encodeURIComponent(term)}&limit=40`;
    let data;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) {
        console.warn(`[Remotive] "${term}" HTTP ${res.status}`);
        continue;
      }
      data = await res.json();
    } catch (error) {
      console.warn(`[Remotive] "${term}" fetch failed: ${error.message}`);
      continue;
    }

    for (const j of data.jobs || []) {
      const id = `remote:${j.id}`;
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        platform: 'Remote',
        title: j.title || '',
        link: j.url || '',
        description: '',
        company: j.company_name || '',
        location: j.candidate_required_location || 'Remote',
        country: 'Remote',
        publishedAt: j.publication_date || new Date().toISOString(),
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const jobs = [...byId.values()].filter((job) => matchesKeyword(job.title, compiled));
  console.log(`[Remotive] Fetched ${byId.size} job(s), ${jobs.length} after keyword filter`);
  // newest first
  jobs.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return jobs.slice(0, maxJobs);
}
