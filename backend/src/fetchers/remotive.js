import { compileKeywordQuery, matchesKeyword } from '../services/keywordFilter.js';

// Remotive's free, no-key JSON endpoint for remote jobs. Same spirit as the
// LinkedIn guest endpoint: just fetch + parse, no API key, no limits.
const ENDPOINT = 'https://remotive.com/api/remote-jobs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Only keep remote jobs the user can actually take: worldwide/anywhere, or
// restricted to one of the target countries (Pakistan / US / UK / Canada /
// Germany) or a broad region that covers them. Drops e.g. "Brazil", "India".
function locationAllowed(loc) {
  const l = (loc || '').toLowerCase().trim();
  if (!l || l === 'remote') return true;
  if (l.includes('worldwide') || l.includes('anywhere') || l.includes('global')) return true;
  const ok = [
    'pakistan',
    'united states',
    'usa',
    'united kingdom',
    'canada',
    'germany',
    'europe',
    'americas',
    'north america',
    'emea',
  ];
  if (ok.some((a) => l.includes(a))) return true;
  return /\b(uk|us)\b/.test(l); // "UK Only", "US timezones"
}

/**
 * Fetch remote dev jobs from Remotive. Runs a few searches across the user's
 * primary stack and merges, then applies the same title keyword filter.
 * @param {string} keywordFilter  boolean title filter
 * @param {number} maxJobs
 * @returns {Promise<Array>}
 */
export async function fetchRemotiveJobs(keywordFilter = '', maxJobs = 50, fTPR = 'r86400') {
  const compiled = compileKeywordQuery(keywordFilter);
  const maxAgeMs = (parseInt(String(fTPR).replace(/[^0-9]/g, ''), 10) || 86400) * 1000;
  const freshAfter = Date.now() - maxAgeMs;
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
      // Only fresh jobs (within the same time window as LinkedIn).
      const pub = j.publication_date ? new Date(j.publication_date).getTime() : 0;
      if (pub && pub < freshAfter) continue;
      // Only locations the user can take.
      if (!locationAllowed(j.candidate_required_location)) continue;
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
