/**
 * The JobSource contract.
 *
 * Adding a new board must never require touching the pipeline, the scorer, the
 * API or the app. It must only require writing ONE file that satisfies this
 * contract and registering it. That is the whole point of this layer.
 *
 * @typedef {Object} FetchContext
 * @property {number}   limit        Max jobs the adapter should return.
 * @property {string[]} countries    Canonical country ids the users care about.
 *                                   Adapters MAY use this to narrow the query;
 *                                   ignoring it is allowed (the scorer filters).
 * @property {number}   sinceMs      Only jobs newer than this age, in ms.
 * @property {Object}   budget       createBudget() guard — stop when expired.
 * @property {Object}   logger       Scoped logger.
 * @property {Object}   config       Adapter-specific config from env.
 *
 * @typedef {Object} SourceCapabilities
 * @property {boolean} description  Provides full job description text.
 * @property {boolean} salary       Provides structured salary.
 * @property {boolean} jobType      Provides employment type.
 * @property {boolean} workplace    Provides remote/hybrid/onsite.
 * @property {boolean} level        Provides seniority.
 * @property {boolean} countryQuery Can filter server-side by country.
 *
 * @typedef {Object} JobSource
 * @property {string}  id                  Stable id, e.g. 'greenhouse'.
 * @property {string}  label               Display name for the badge.
 * @property {string}  homepage
 * @property {boolean} available           False = cannot run from our infra.
 * @property {string|null} unavailableReason
 * @property {SourceCapabilities} capabilities
 * @property {(ctx: FetchContext) => Promise<import('../core/normalizedJob.js').NormalizedJob[]>} fetchJobs
 * @property {(jobs, ctx) => Promise<number>} [enrich]  Optional 2nd pass that
 *           fills missing metadata for jobs that survived dedupe. Returns the
 *           number of jobs it enriched.
 */

/**
 * Helper for declaring a source with sane defaults, so adapters stay short and
 * a missing capability flag can never read as `undefined`.
 * @param {Partial<JobSource>} definition
 * @returns {JobSource}
 */
export function defineSource(definition) {
  if (!definition.id) throw new Error('defineSource: id is required');
  if (typeof definition.fetchJobs !== 'function') {
    throw new Error(`defineSource(${definition.id}): fetchJobs must be a function`);
  }

  return {
    id: definition.id,
    label: definition.label || definition.id,
    homepage: definition.homepage || '',
    available: definition.available !== false,
    unavailableReason: definition.unavailableReason || null,
    /** Attribution text some boards require in their ToS (RemoteOK). */
    attribution: definition.attribution || null,
    /**
     * Optional per-source cap on the lookback window.
     *
     * Only set this on a source that filters by date SERVER-side and is polled
     * every run — for those, a long window is pure redundant re-fetching. A
     * source that is rotated or filtered client-side must inherit the global
     * window, because there the window is its entire visibility budget.
     */
    maxSinceMs: definition.maxSinceMs ?? null,
    capabilities: {
      description: false,
      salary: false,
      jobType: false,
      workplace: false,
      level: false,
      countryQuery: false,
      ...(definition.capabilities || {}),
    },
    fetchJobs: definition.fetchJobs,
    enrich: definition.enrich || null,
  };
}

/**
 * Declare a source we know about but cannot legally/technically fetch yet.
 * It still appears in `GET /api/sources` so the app can show it as "coming
 * soon" rather than pretending it does not exist.
 *
 * @param {string} id
 * @param {string} label
 * @param {string} reason
 * @param {string} homepage
 */
export function defineUnavailableSource(id, label, reason, homepage = '') {
  return defineSource({
    id,
    label,
    homepage,
    available: false,
    unavailableReason: reason,
    fetchJobs: async () => [],
  });
}
