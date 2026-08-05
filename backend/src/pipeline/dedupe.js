/**
 * Deduplication.
 *
 * The same job genuinely appears on several boards: a company posts on
 * Greenhouse, it syndicates to LinkedIn, an aggregator reposts it to RemoteOK.
 * Showing it three times destroys the "quality over quantity" promise.
 *
 * THREE layers, cheapest first:
 *
 *  1. EXACT KEY   sha1(titleNorm | companyNorm | country). Because this is also
 *                 the Firestore document id, cross-RUN dedupe is free — a
 *                 re-fetched job simply resolves to an existing doc.
 *
 *  2. URL IDENTITY  Canonicalised apply URL (host + path, no tracking params).
 *                   Catches the same posting reached by two different links.
 *
 *  3. NEAR-DUPLICATE  Same company + country, with a token-overlap (Jaccard)
 *                     similarity above a threshold. Catches "React Native
 *                     Engineer" vs "Engineer, React Native" which layer 1
 *                     misses because the hash is exact.
 *
 * Layer 3 is deliberately scoped to WITHIN a company. Comparing every job to
 * every other job is O(n^2); bucketing by company keeps buckets tiny, so the
 * cost stays linear in practice.
 */

import { createLogger } from '../core/logger.js';

const log = createLogger('Dedupe');

/** Titles this similar are considered the same role. Tuned conservatively. */
const NEAR_DUP_THRESHOLD = 0.82;

/**
 * How much do we trust a source's metadata when merging two records?
 * Higher wins the "primary" slot (its applyUrl and description are kept).
 * Structured-data sources beat inference-only sources.
 */
const SOURCE_PRIORITY = {
  ashby: 100, // structured salary + workplace + type
  lever: 90, // structured country + workplace
  greenhouse: 80, // full description
  remoteok: 70,
  weworkremotely: 65,
  rozee: 60,
  linkedin: 50, // richest reach, thinnest structured metadata
};

/** Strip tracking noise so two links to the same posting compare equal. */
export function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path}`.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

/** Jaccard similarity over word tokens. 1 = identical sets. */
function similarity(a, b) {
  const left = new Set(a.split(' ').filter(Boolean));
  const right = new Set(b.split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;

  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

/** How complete is this record? Used to pick a winner between duplicates. */
function completeness(job) {
  let score = SOURCE_PRIORITY[job.sourceId] ?? 40;
  if (job.description) score += Math.min(30, job.description.length / 200);
  if (job.salary) score += 20;
  if (job.workplace) score += 10;
  if (job.jobType) score += 10;
  if (job.experienceLevel) score += 10;
  score += job.skills.length * 2;
  return score;
}

/**
 * Merge a duplicate into the winner, keeping the union of what each knows.
 *
 * WHY union and not "winner takes all": LinkedIn may be the only source that
 * knows the seniority while Ashby is the only one with the salary. Discarding
 * either would make the recommendation worse than the sum of its inputs.
 */
function merge(winner, loser) {
  winner.seenInSources = [...new Set([...winner.seenInSources, ...loser.seenInSources])];
  winner.skills = [...new Set([...winner.skills, ...loser.skills])];
  winner.workplace = winner.workplace || loser.workplace;
  winner.jobType = winner.jobType || loser.jobType;
  winner.experienceLevel = winner.experienceLevel || loser.experienceLevel;
  winner.country = winner.country || loser.country;
  winner.location = winner.location || loser.location;
  winner.company = winner.company || loser.company;
  winner.enriched = winner.enriched || loser.enriched;

  if (!winner.salary && loser.salary) {
    winner.salary = loser.salary;
    winner.salaryAnnualUsd = loser.salaryAnnualUsd;
  }
  if ((loser.description?.length || 0) > (winner.description?.length || 0)) {
    winner.description = loser.description;
  }
  // Keep the EARLIEST posting date — that is when the job actually went live.
  if (loser.postedAt && loser.postedAt < winner.postedAt) winner.postedAt = loser.postedAt;

  // Tags are derived; recompute the ones that changed.
  const extra = [
    ...loser.skills.map((s) => `skill:${s}`),
    `source:${loser.sourceId}`,
    winner.workplace ? `workplace:${winner.workplace}` : null,
    winner.jobType ? `type:${winner.jobType}` : null,
    winner.experienceLevel ? `level:${winner.experienceLevel}` : null,
  ].filter(Boolean);
  winner.tags = [...new Set([...winner.tags, ...extra])].slice(0, 40);

  return winner;
}

/**
 * Collapse a batch of freshly-fetched jobs down to unique postings.
 *
 * @param {import('../core/normalizedJob.js').NormalizedJob[]} jobs
 * @returns {{jobs: import('../core/normalizedJob.js').NormalizedJob[], removed: number}}
 */
export function dedupeBatch(jobs) {
  const byKey = new Map();
  const byUrl = new Map();
  let removed = 0;

  // --- Layers 1 & 2: exact key, then URL identity -------------------------
  for (const job of jobs) {
    const urlKey = canonicalUrl(job.applyUrl);
    const existingKey = byKey.get(job.jobKey);
    const existingUrl = byUrl.get(urlKey);
    const existing = existingKey || existingUrl;

    if (!existing) {
      byKey.set(job.jobKey, job);
      byUrl.set(urlKey, job);
      continue;
    }

    removed++;
    const winner = completeness(job) > completeness(existing) ? job : existing;
    const loser = winner === job ? existing : job;
    const merged = merge(winner, loser);

    // The merged record keeps the WINNER's identity, so re-point both indexes.
    byKey.set(existing.jobKey, merged);
    byKey.set(job.jobKey, merged);
    byUrl.set(urlKey, merged);
    byUrl.set(canonicalUrl(merged.applyUrl), merged);
  }

  // --- Layer 3: near-duplicates within the same company + country ---------
  const unique = [...new Set(byKey.values())];
  const buckets = new Map();
  for (const job of unique) {
    const bucketId = `${job.companyNorm}|${job.country || ''}`;
    if (!buckets.has(bucketId)) buckets.set(bucketId, []);
    buckets.get(bucketId).push(job);
  }

  const survivors = [];
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      survivors.push(bucket[0]);
      continue;
    }

    const kept = [];
    for (const job of bucket) {
      const twin = kept.find((other) => similarity(job.titleNorm, other.titleNorm) >= NEAR_DUP_THRESHOLD);
      if (twin) {
        removed++;
        const winner = completeness(job) > completeness(twin) ? job : twin;
        const loser = winner === job ? twin : job;
        const merged = merge(winner, loser);
        kept[kept.indexOf(twin)] = merged;
      } else {
        kept.push(job);
      }
    }
    survivors.push(...kept);
  }

  if (removed) log.info('collapsed duplicates', { in: jobs.length, out: survivors.length, removed });
  return { jobs: survivors, removed };
}

/**
 * Merge a freshly-fetched job with the version already stored.
 * Used when a job we have seen before arrives from a NEW source — we want to
 * record the extra source and any metadata it adds, without resurfacing the
 * job as "new".
 */
export function mergeWithStored(fresh, stored) {
  const winner = completeness(stored) >= completeness(fresh) ? { ...stored } : { ...fresh };
  const loser = winner.sourceId === stored.sourceId ? fresh : stored;
  return merge(winner, loser);
}
