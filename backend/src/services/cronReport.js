/**
 * Run telemetry, persisted to `cron_status/latest` for the app's Status screen.
 *
 * The report is now SOURCE-ARRAY shaped rather than having a hard-coded field
 * per board — adding a source must not require a schema change here or a new
 * release of the app. The old `linkedin` / `upwork` keys are still emitted so
 * an older installed APK keeps rendering instead of crashing.
 */

import admin from 'firebase-admin';
import { getFirestore } from '../firebase/admin.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('CronReport');
const CRON_STATUS_DOC = 'cron_status/latest';

/**
 * @param {Object} input
 * @param {Object[]} input.sourceReports  from the ingest pipeline
 * @param {Object}   input.ingestStats
 * @param {Object}   input.fanoutStats
 * @param {number}   input.durationSeconds
 * @param {string|null} input.fatalError
 * @param {number}   input.exitCode
 */
export function buildCronReport({
  sourceReports = [],
  ingestStats = {},
  fanoutStats = {},
  durationSeconds = 0,
  fatalError = null,
  exitCode = 0,
}) {
  const errored = sourceReports.filter((report) => report.status === 'error');
  const ok = sourceReports.filter((report) => report.status === 'ok');

  let status = 'success';
  if (fatalError) status = 'failed';
  else if (!ok.length && errored.length) status = 'failed';
  else if (errored.length) status = 'partial';

  const runSource = process.env.VERCEL
    ? 'vercel'
    : process.env.GITHUB_ACTIONS === 'true'
      ? 'github-actions'
      : 'local';

  const linkedinReport = sourceReports.find((report) => report.sourceId === 'linkedin');

  return {
    lastRunAt: new Date().toISOString(),
    status,
    exitCode,
    runSource,
    durationSeconds,
    fatalError,

    sources: sourceReports.map((report) => ({
      sourceId: report.sourceId,
      status: report.status,
      jobsFetched: report.jobs ?? 0,
      rejected: report.rejected ?? 0,
      error: report.error ?? null,
      durationMs: report.durationMs ?? 0,
    })),

    ingest: {
      fetched: ingestStats.fetched ?? 0,
      duplicatesRemoved: ingestStats.duplicatesRemoved ?? 0,
      newJobs: ingestStats.new ?? 0,
      updatedJobs: ingestStats.updated ?? 0,
      enriched: ingestStats.enriched ?? 0,
      /**
       * Stranded jobs repaired this run.
       *
       * Surfaced deliberately: the backlog drainer failed silently once
       * already (a missing composite index swallowed by a debug-level catch)
       * and reported nothing for as long as it was broken. A repair job that
       * is not measured is indistinguishable from a repair job with nothing
       * to do.
       */
      backfilled: ingestStats.backfilled ?? 0,
    },

    personalization: {
      users: fanoutStats.users ?? 0,
      feedEntriesWritten: fanoutStats.entriesWritten ?? 0,
      notificationsSent: fanoutStats.notificationsSent ?? 0,
      usersNotified: fanoutStats.usersNotified ?? 0,
      feedRebuilds: fanoutStats.rebuilds ?? 0,
    },

    // --- legacy keys: keep older installed APKs rendering ---------------
    linkedin: {
      status: linkedinReport?.status ?? 'disabled',
      jobsFetched: linkedinReport?.jobs ?? 0,
      error: linkedinReport?.error ?? null,
      sampleJobs: [],
    },
    upwork: { status: 'disabled', jobsFetched: 0, error: null, sampleJobs: [] },
    processing: {
      processed: ingestStats.fetched ?? 0,
      skipped: ingestStats.duplicatesRemoved ?? 0,
      notified: fanoutStats.notificationsSent ?? 0,
      errors: errored.length,
    },
  };
}

export async function saveCronRunReport(report) {
  await getFirestore()
    .doc(CRON_STATUS_DOC)
    .set({ ...report, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: false });

  log.info('run report saved', {
    status: report.status,
    newJobs: report.ingest.newJobs,
    notified: report.personalization.notificationsSent,
  });
}
