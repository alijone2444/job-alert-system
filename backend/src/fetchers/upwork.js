import Parser from 'rss-parser';

const parser = new Parser({
  customFields: {
    item: ['guid'],
  },
});

/**
 * Normalize an Upwork RSS item into a unified job shape.
 */
function normalizeUpworkItem(item) {
  const guid = item.guid || item.id || item.link;
  if (!guid) {
    return null;
  }

  const title = (item.title || '').trim();
  const link = (item.link || '').trim();
  const description = (item.contentSnippet || item.content || item.summary || '').trim();
  const pubDate = item.pubDate || item.isoDate || new Date().toISOString();

  if (!title || !link) {
    return null;
  }

  return {
    id: `upwork:${guid}`,
    platform: 'Upwork',
    title,
    link,
    description,
    company: 'Upwork Client',
    location: '',
    publishedAt: new Date(pubDate).toISOString(),
  };
}

/**
 * Fetch jobs from the Upwork RSS feed.
 * @param {string} rssUrl
 * @param {string} keywordFilter - optional lowercase keyword filter
 * @returns {Promise<Array>}
 */
export async function fetchUpworkJobs(rssUrl, keywordFilter = '') {
  if (!rssUrl) {
    throw new Error('UPWORK_RSS_URL is not configured');
  }

  let feed;

  try {
    feed = await parser.parseURL(rssUrl);
  } catch (error) {
    throw new Error(`Failed to fetch Upwork RSS feed: ${error.message}`);
  }

  if (!feed?.items?.length) {
    console.warn('[Upwork] RSS feed returned no items');
    return [];
  }

  const jobs = feed.items
    .map(normalizeUpworkItem)
    .filter(Boolean)
    .filter((job) => {
      if (!keywordFilter) return true;
      const haystack = `${job.title} ${job.description}`.toLowerCase();
      return haystack.includes(keywordFilter);
    });

  console.log(`[Upwork] Parsed ${jobs.length} job(s) from RSS feed`);
  return jobs;
}
