import { jobExists, saveJob, getActiveDeviceTokens } from './firestore.js';
import { sendJobAlert } from './notifications.js';

/**
 * Process a list of fetched jobs: deduplicate, notify, and persist.
 * @param {Array} jobs
 * @param {number} maxJobs
 * @returns {Promise<{processed: number, skipped: number, notified: number, errors: number}>}
 */
export async function processJobs(jobs, maxJobs = 50) {
  const stats = { processed: 0, skipped: 0, notified: 0, errors: 0 };

  if (!jobs.length) {
    console.log('[Processor] No jobs to process');
    return stats;
  }

  const sortedJobs = [...jobs].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  const jobsToProcess = sortedJobs.slice(0, maxJobs);
  let deviceTokens = null;

  for (const job of jobsToProcess) {
    stats.processed++;

    try {
      const exists = await jobExists(job.id);

      if (exists) {
        stats.skipped++;
        console.log(`[Processor] Skipping duplicate: ${job.id}`);
        continue;
      }

      if (!deviceTokens) {
        deviceTokens = await getActiveDeviceTokens();
      }

      if (deviceTokens.length > 0) {
        await sendJobAlert(deviceTokens, job);
      } else {
        console.warn(`[Processor] New job found but no devices registered: ${job.title}`);
      }

      await saveJob(job);
      stats.notified++;
      console.log(`[Processor] Saved and notified: ${job.platform} — ${job.title}`);
    } catch (error) {
      stats.errors++;
      console.error(`[Processor] Error processing job ${job.id}: ${error.message}`);
    }
  }

  return stats;
}
