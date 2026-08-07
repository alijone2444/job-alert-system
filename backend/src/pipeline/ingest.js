/**
 * Ingestion pipeline:
 *
 *   sources -> normalize -> dedupe(batch) -> reconcile(stored) -> enrich -> persist
 *
 * Each stage has one job and hands a plain array to the next, so a new source
 * or a new enrichment step slots in without touching the others.
 *
 * TWO properties this stage must guarantee, because everything downstream
 * assumes them:
 *
 *  1. NEVER exceed the time budget. Vercel kills the invocation with no chance
 *     to persist, so a run that tries to do too much accomplishes nothing at
 *     all. Every loop checks the budget and degrades to "less work this run".
 *
 *  2. NEVER let one bad source take down the run. Adapters are wrapped
 *     individually; a 403 from one board must not cost us the other five.
 */

import { createLogger } from '../core/logger.js';
import { createBudget } from '../core/http.js';
import { isPublishable } from '../core/normalizedJob.js';
import { getEnabledSources } from '../sources/registry.js';
import { dedupeBatch, mergeWithStored } from './dedupe.js';
import * as jobsRepo from '../repositories/jobsRepo.js';
import { recordSourceHealth } from '../repositories/settingsRepo.js';

const log = createLogger('Ingest');

/**
 * Run one ingestion cycle.
 *
 * @param {Object} options
 * @param {string[]} options.countries    Union of user country preferences.
 * @param {Object}   options.settings     From settingsRepo.getIngestSettings().
 * @param {Object}   [options.budget]       Budget for the FETCH stage.
 * @param {number}   [options.enrichBudgetMs] Milliseconds granted to enrichment.
 * @returns {Promise<{newJobs:Object[], updatedJobs:Object[], sourceReports:Object[], stats:Object}>}
 */
export async function runIngestion({
  countries = [],
  settings,
  budget = null,
  enrichBudgetMs = 0,
}) {
  const runBudget = budget || createBudget(settings.runBudgetMs);

  /**
   * Rotate which source goes first each run.
   *
   * The fetch budget usually runs out partway through the list, and iterating
   * a fixed order meant the SAME trailing sources were skipped every single
   * time — observed live: ashby, remoteok and weworkremotely deferred on every
   * run, i.e. never fetched at all. Deferral is only acceptable if it is fair.
   */
  const sourceCount = getEnabledSources().length;
  const offset = sourceCount ? Math.floor(Date.now() / 120_000) % sourceCount : 0;
  const enabled = getEnabledSources();
  const sources = [...enabled.slice(offset), ...enabled.slice(0, offset)];

  const fetched = [];
  const sourceReports = [];

  /* ------------------------------ 1. FETCH ------------------------------ */
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];

    if (runBudget.expired(4_000)) {
      // Stop the whole stage, not just this source. Sources are rotated across
      // runs, so whatever we skip here leads the next cycle two minutes later.
      const skipped = sources.slice(index);
      log.warn('ingest budget exhausted — deferring sources to the next run', {
        skipped: skipped.map((s) => s.id),
      });
      for (const remaining of skipped) {
        sourceReports.push({
          sourceId: remaining.id,
          status: 'skipped',
          jobs: 0,
          error: null,
          durationMs: 0,
        });
      }
      break;
    }

    const startedAt = Date.now();
    const sourceLogger = log.child(source.id);

    try {
      const jobs = await source.fetchJobs({
        limit: settings.maxJobsPerSource,
        countries,
        // A source may narrow the window, never widen it.
        sinceMs: Math.min(settings.freshnessWindowMs, source.maxSinceMs ?? Infinity),
        budget: runBudget,
        logger: sourceLogger,
        config: {},
      });

      // The quality gate runs here, at the boundary — a malformed job never
      // enters the pipeline, so nothing downstream needs to defend against it.
      const publishable = jobs.filter(isPublishable);
      const rejected = jobs.length - publishable.length;

      fetched.push(...publishable);
      sourceReports.push({
        sourceId: source.id,
        status: 'ok',
        jobs: publishable.length,
        rejected,
        error: null,
        durationMs: Date.now() - startedAt,
      });
      sourceLogger.info('fetched', { jobs: publishable.length, rejected });
    } catch (error) {
      sourceReports.push({
        sourceId: source.id,
        status: 'error',
        jobs: 0,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });
      sourceLogger.error('fetch failed', { error: error.message });
    }
  }

  /* ----------------------------- 2. DEDUPE ------------------------------ */
  const { jobs: deduped, removed } = dedupeBatch(fetched);

  /* --------------------- 3. RECONCILE AGAINST STORE --------------------- */
  // Split into genuinely-new jobs vs ones we have already surfaced. Only the
  // new ones can trigger a notification — this is what stops the 2-minute cron
  // from spamming the same job every cycle.
  const existing = await jobsRepo.findExisting(deduped.map((job) => job.jobKey));

  const newJobs = [];
  const updatedJobs = [];

  for (const job of deduped) {
    const stored = existing.get(job.jobKey);
    if (!stored) {
      newJobs.push(job);
      continue;
    }
    // Already known. Only rewrite it if this sighting genuinely adds something
    // (a new source, or metadata the stored copy lacks) — otherwise we would
    // burn a write on every job every 2 minutes.
    const merged = mergeWithStored(job, stored);
    if (hasNewInformation(stored, merged)) updatedJobs.push(merged);
  }

  /* ----------------------------- 4. ENRICH ------------------------------ */
  // Only NEW jobs are enriched: detail requests are the scarcest resource in
  // the system (one HTTP call per job, rate-limited), so they are spent solely
  // on jobs that are about to be scored and shown for the first time.
  /**
   * Enrichment gets its own budget, CREATED HERE rather than passed in from
   * the caller. A budget is a stopwatch: one started at the beginning of the
   * run has already elapsed by the time this stage is reached, so an
   * "8s enrichment budget" handed down from the engine was always expired on
   * arrival and `enriched` sat at 0 forever. Start the clock when the work
   * starts.
   */
  const detailBudget = createBudget(enrichBudgetMs || 8_000);

  let enrichedCount = 0;
  const backfilled = [];

  for (const source of sources) {
    if (!source.enrich || detailBudget.expired(1_000)) continue;

    const candidates = newJobs.filter((job) => job.sourceId === source.id && !job.enriched);

    /**
     * BACKLOG. New jobs get first claim on the detail budget, but any spare
     * capacity goes to jobs stranded by earlier runs.
     *
     * Without this, a job that arrived in a busy run was written with no
     * description and no skills and stayed that way forever — 35% of stored
     * LinkedIn jobs — which meant it could never clear the notification
     * threshold no matter how well it actually matched someone.
     */
    if (candidates.length < settings.maxEnrichPerRun) {
      try {
        const stale = await jobsRepo.findUnenriched(source.id, {
          limit: settings.maxEnrichPerRun - candidates.length,
          sinceMs: settings.retentionMs,
        });
        candidates.push(...stale);
        backfilled.push(...stale);
      } catch (error) {
        // WARN, not debug. The first version logged this at debug level and a
        // missing-index error hid there indefinitely while the backlog
        // reported zero. A silently-failing repair job is worse than no repair
        // job, because it looks like there is nothing to repair.
        log.warn('could not load enrichment backlog', {
          sourceId: source.id,
          error: error.message,
        });
      }
    }

    if (!candidates.length) continue;

    try {
      enrichedCount += await source.enrich(candidates, {
        budget: detailBudget,
        logger: log.child(`${source.id}:enrich`),
        maxDetail: settings.maxEnrichPerRun,
      });
    } catch (error) {
      log.warn('enrichment failed', { sourceId: source.id, error: error.message });
    }
  }

  // Backlog jobs already exist, so they must be re-saved to keep what the
  // detail pass just learned. Only the ones it actually reached.
  const enrichedBacklog = backfilled.filter((job) => job.enriched);
  for (const job of enrichedBacklog) refreshDerivedFields(job);

  // Enrichment rewrites skills/type/level, so the derived fields must be
  // rebuilt before the job is stored or scored.
  for (const job of newJobs) refreshDerivedFields(job);

  /* ----------------------------- 5. PERSIST ----------------------------- */
  await jobsRepo.saveJobs([...newJobs, ...updatedJobs, ...enrichedBacklog]);

  for (const report of sourceReports) {
    await recordSourceHealth(report.sourceId, {
      lastStatus: report.status,
      lastJobs: report.jobs,
      lastError: report.error,
      lastDurationMs: report.durationMs,
      lastRunAt: new Date().toISOString(),
    });
  }

  const stats = {
    fetched: fetched.length,
    duplicatesRemoved: removed,
    new: newJobs.length,
    updated: updatedJobs.length,
    enriched: enrichedCount,
    backfilled: enrichedBacklog.length,
    elapsedMs: runBudget.elapsedMs(),
  };

  log.info('ingestion complete', stats);
  return { newJobs, updatedJobs, sourceReports, stats };
}

/**
 * Did this sighting teach us anything? Guards against pointless writes.
 */
function hasNewInformation(stored, merged) {
  if ((merged.seenInSources?.length || 0) > (stored.seenInSources?.length || 0)) return true;
  if ((merged.skills?.length || 0) > (stored.skills?.length || 0)) return true;
  for (const field of ['workplace', 'jobType', 'experienceLevel', 'salary', 'country']) {
    if (!stored[field] && merged[field]) return true;
  }
  return false;
}

/** Recompute tags after enrichment changed the underlying fields. */
function refreshDerivedFields(job) {
  const tags = job.skills.map((skill) => `skill:${skill}`);
  if (job.country) tags.push(`country:${job.country}`);
  if (job.workplace) tags.push(`workplace:${job.workplace}`);
  if (job.jobType) tags.push(`type:${job.jobType}`);
  if (job.experienceLevel) tags.push(`level:${job.experienceLevel}`);
  for (const sourceId of job.seenInSources) tags.push(`source:${sourceId}`);
  job.tags = [...new Set(tags)].slice(0, 40);
}
