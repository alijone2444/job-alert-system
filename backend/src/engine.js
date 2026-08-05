/**
 * The engine — one full cycle, triggered every ~2 minutes by cron-job.org via
 * `GET /api/run`.
 *
 *   ingest (fetch -> normalize -> dedupe -> enrich -> store)
 *      |
 *   fan-out (score every new job against every user -> feeds + push)
 *      |
 *   maintenance (retention prune, telemetry)
 *
 * BACKWARD COMPATIBILITY: the exported name, signature and return value are
 * unchanged (`runEngine(): Promise<number>` returning an exit code, never
 * calling process.exit). `api/run.js`, `src/index.js` and `src/poll.js` all
 * keep working untouched — the existing cron URL does not change.
 *
 * WHY the whole run is budgeted: this used to be a fetch-and-notify script
 * where overrunning was harmless. It is now a multi-stage pipeline, and on
 * Vercel an overrun is a hard kill with nothing persisted. The budget makes a
 * slow run degrade into "less work this cycle" instead of "no work at all" —
 * and with a 2-minute cadence, the next run picks up the remainder anyway.
 */

import { loadConfig } from './config.js';
import { initFirebase } from './firebase/admin.js';
import { createLogger } from './core/logger.js';
import { createBudget } from './core/http.js';
import { runIngestion } from './pipeline/ingest.js';
import { fanOut } from './reco/fanout.js';
import * as usersRepo from './repositories/usersRepo.js';
import * as jobsRepo from './repositories/jobsRepo.js';
import {
  getIngestSettings,
  getScoringConfig,
  getActiveCountries,
} from './repositories/settingsRepo.js';
import { buildCronReport, saveCronRunReport } from './services/cronReport.js';

const log = createLogger('Engine');

/** Prune at most once every ~30 minutes rather than on every 2-minute run. */
const PRUNE_PROBABILITY = 0.07;

/** Fan-out never gets less than this, however long ingestion took. */
const FANOUT_MIN_BUDGET_MS = 12_000;

/** Shares of the run budget reserved for fetching and for detail enrichment. */
const FETCH_BUDGET_SHARE = 0.45;
const ENRICH_BUDGET_SHARE = 0.18;

/**
 * @returns {Promise<number>} exit code — 0 ok, 1 failure
 */
export async function runEngine() {
  const startedAt = Date.now();

  let firebaseReady = false;
  let fatalError = null;
  let exitCode = 0;
  let sourceReports = [];
  let ingestStats = {};
  let fanoutStats = {};

  log.info('run started', { at: new Date().toISOString() });

  try {
    const config = loadConfig();
    initFirebase(config.firebaseServiceAccount);
    firebaseReady = true;

    const settings = await getIngestSettings();
    const scoringConfig = await getScoringConfig();

    /**
     * THREE budgets, and the split is load-bearing.
     *
     * A single shared budget was tried first and failed twice, both times
     * silently: fetching consumed everything, so fan-out was skipped and no
     * user's feed was ever built; then enrichment was skipped, so LinkedIn
     * jobs never gained the skills data the scorer needs. In both cases the
     * run reported "success" while doing nothing useful.
     *
     * So each stage gets a guaranteed slice, ordered by how much the PRODUCT
     * depends on it — fan-out is the product, enrichment is what makes
     * personalisation accurate, fetching merely supplies raw material and is
     * the one stage that can safely be cut short, because sources rotate and
     * the next run (two minutes later) picks up what this one skipped.
     *
     * Only the budgets whose stage starts NOW are created here; the later
     * stages receive a duration and start their own clock when they begin.
     */
    const budget = createBudget(settings.runBudgetMs);
    const fetchBudget = createBudget(Math.round(settings.runBudgetMs * FETCH_BUDGET_SHARE));
    const enrichBudgetMs = Math.round(settings.runBudgetMs * ENRICH_BUDGET_SHARE);

    /* ---------------------------------------------------------------- */
    /* Which countries to fetch is driven by what users actually want.   */
    /* Fetching all 12 taxonomy countries would burn the entire budget   */
    /* on geographies nobody has selected.                               */
    /* ---------------------------------------------------------------- */
    const users = await usersRepo.listUsers();
    const preferencesByUser = await usersRepo.getPreferencesForUsers(
      users.map((user) => user.userId)
    );
    const countries = await getActiveCountries(preferencesByUser);

    log.info('run context', {
      users: users.length,
      countries: countries.length ? countries : 'worldwide',
      budgetMs: settings.runBudgetMs,
    });

    /* ----------------------------- INGEST ---------------------------- */
    const ingestion = await runIngestion({
      countries,
      settings,
      budget: fetchBudget,
      enrichBudgetMs,
    });
    sourceReports = ingestion.sourceReports;
    ingestStats = ingestion.stats;

    /* ---------------------------- FAN-OUT ---------------------------- */
    // Runs even when nothing new arrived: a user who just changed their
    // preferences still needs their feed rebuilt this cycle.
    //
    // Given a GUARANTEED floor rather than "whatever ingestion left over".
    // Without the floor a slow fetch silently produces a run that stores jobs
    // and shows none of them — the failure this pipeline exists to avoid.
    fanoutStats = await fanOut({
      newJobs: ingestion.newJobs,
      scoringConfig,
      budget: createBudget(Math.max(FANOUT_MIN_BUDGET_MS, budget.remainingMs())),
      notify: true,
    });

    /* -------------------------- MAINTENANCE -------------------------- */
    if (Math.random() < PRUNE_PROBABILITY && !budget.expired(8_000)) {
      await jobsRepo.pruneOlderThan(settings.retentionMs);
    }

    const failedSources = sourceReports.filter((report) => report.status === 'error');
    if (failedSources.length && failedSources.length === sourceReports.length) exitCode = 1;

    log.info('run finished', {
      durationS: ((Date.now() - startedAt) / 1000).toFixed(1),
      newJobs: ingestStats.new,
      notified: fanoutStats.notificationsSent,
    });

    return exitCode;
  } catch (error) {
    fatalError = error.message;
    exitCode = 1;
    log.error('fatal', { error: error.message });
    if (error.stack) console.error(error.stack);
    return 1;
  } finally {
    if (firebaseReady) {
      try {
        await saveCronRunReport(
          buildCronReport({
            sourceReports,
            ingestStats,
            fanoutStats,
            durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
            fatalError,
            exitCode,
          })
        );
      } catch (error) {
        log.error('could not save run report', { error: error.message });
      }
    }
  }
}
