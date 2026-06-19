import admin from 'firebase-admin';
import { getFirestore } from '../firebase/admin.js';

const CRON_STATUS_DOC = 'cron_status/latest';

/**
 * Persist the latest backend/cron run report so the mobile app can verify
 * Upwork, LinkedIn, and GitHub Actions health.
 */
export async function saveCronRunReport(report) {
  const db = getFirestore();

  const payload = {
    ...report,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.doc(CRON_STATUS_DOC).set(payload, { merge: false });

  console.log('[CronReport] Saved run status to Firestore cron_status/latest');
  console.log('[CronReport] Upwork:', report.upwork.jobsFetched, 'jobs —', report.upwork.status);
  console.log('[CronReport] LinkedIn:', report.linkedin.jobsFetched, 'jobs —', report.linkedin.status);
  console.log('[CronReport] Overall status:', report.status);
}

/**
 * Build a cron report object from run results.
 */
export function buildCronReport({
  results,
  stats,
  durationSeconds,
  fatalError = null,
  exitCode = 0,
}) {
  const upworkError = results.upwork.error ?? null;
  const linkedinError = results.linkedin.error ?? null;

  let status = 'success';
  if (fatalError) {
    status = 'failed';
  } else if (results.upwork.status === 'error' && results.linkedin.status === 'error') {
    status = 'failed';
  } else if (results.upwork.status === 'error' || results.linkedin.status === 'error') {
    status = 'partial';
  } else if (stats?.errors > 0) {
    status = 'partial';
  }

  const runSource = process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local';

  return {
    lastRunAt: new Date().toISOString(),
    status,
    exitCode,
    runSource,
    durationSeconds,
    fatalError,
    upwork: {
      status: results.upwork.status,
      jobsFetched: results.upwork.jobs.length,
      error: upworkError,
      sampleJobs: results.upwork.jobs.slice(0, 3).map((job) => ({
        title: job.title,
        link: job.link,
        platform: job.platform,
      })),
    },
    linkedin: {
      status: results.linkedin.status,
      jobsFetched: results.linkedin.jobs.length,
      error: linkedinError,
      sampleJobs: results.linkedin.jobs.slice(0, 3).map((job) => ({
        title: job.title,
        link: job.link,
        platform: job.platform,
      })),
    },
    processing: stats ?? {
      processed: 0,
      skipped: 0,
      notified: 0,
      errors: 0,
    },
  };
}
