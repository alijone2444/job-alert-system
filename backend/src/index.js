import { loadConfig } from './config.js';
import { initFirebase } from './firebase/admin.js';
import { fetchUpworkJobs } from './fetchers/upwork.js';
import { fetchLinkedInJobs } from './fetchers/linkedin.js';
import { processJobs } from './services/jobProcessor.js';
import { buildCronReport, saveCronRunReport } from './services/cronReport.js';

const emptyResults = () => ({
  upwork: { status: 'pending', jobs: [], error: null },
  linkedin: { status: 'pending', jobs: [], error: null },
});

async function runEngine() {
  const startTime = Date.now();
  let config;
  let results = emptyResults();
  let stats = { processed: 0, skipped: 0, notified: 0, errors: 0 };
  let fatalError = null;
  let exitCode = 0;
  let firebaseReady = false;

  console.log('=== Job Alert Engine Started ===');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Run source: ${process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions (cron)' : 'Local'}`);

  try {
    config = loadConfig();
    initFirebase(config.firebaseServiceAccount);
    firebaseReady = true;

    try {
      results.upwork.jobs = await fetchUpworkJobs(config.upworkRssUrl, config.keywordFilter);
      results.upwork.status = 'ok';
    } catch (error) {
      results.upwork.status = 'error';
      results.upwork.error = error.message;
      console.error(`[Upwork] ${error.message}`);
    }

    try {
      results.linkedin.jobs = await fetchLinkedInJobs(
        config.linkedinSearchUrl,
        config.linkedinLiAt,
        config.keywordFilter
      );
      results.linkedin.status = 'ok';
    } catch (error) {
      results.linkedin.status = 'error';
      results.linkedin.error = error.message;
      console.error(`[LinkedIn] ${error.message}`);
    }

    const allJobs = [...results.upwork.jobs, ...results.linkedin.jobs];

    if (!allJobs.length) {
      if (results.upwork.status === 'error' && results.linkedin.status === 'error') {
        console.error('=== Job Alert Engine Failed — both fetchers errored ===');
        exitCode = 1;
      } else {
        console.log('=== Job Alert Engine Finished — no jobs fetched this run ===');
        console.log(`  Upwork:   ${results.upwork.jobs.length} jobs (${results.upwork.status})`);
        console.log(`  LinkedIn: ${results.linkedin.jobs.length} jobs (${results.linkedin.status})`);
      }
      return exitCode;
    }

    console.log(`[Main] Combined ${allJobs.length} job(s) from both platforms`);
    stats = await processJobs(allJobs, config.maxJobsPerRun);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('=== Job Alert Engine Summary ===');
    console.log(`  Upwork:   ${results.upwork.jobs.length} fetched (${results.upwork.status})`);
    console.log(`  LinkedIn: ${results.linkedin.jobs.length} fetched (${results.linkedin.status})`);
    console.log(`  Processed: ${stats.processed}`);
    console.log(`  Skipped:   ${stats.skipped} (duplicates)`);
    console.log(`  Notified:  ${stats.notified} (new alerts)`);
    console.log(`  Errors:    ${stats.errors}`);
    console.log(`  Duration:  ${elapsed}s`);
    console.log('=== Job Alert Engine Finished ===');

    if (stats.errors > 0 && stats.notified === 0) {
      exitCode = 1;
    }

    return exitCode;
  } catch (error) {
    fatalError = error.message;
    exitCode = 1;
    console.error(`[Fatal] ${error.message}`);
    if (error.stack) console.error(error.stack);
    return 1;
  } finally {
    if (firebaseReady) {
      try {
        const durationSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
        const report = buildCronReport({
          results,
          stats,
          durationSeconds,
          fatalError,
          exitCode,
        });
        await saveCronRunReport(report);
      } catch (error) {
        console.error(`[CronReport] Failed to save status: ${error.message}`);
      }
    }
  }
}

runEngine()
  .then((code) => process.exit(code ?? 0))
  .catch((error) => {
    console.error(`[Fatal] Unhandled: ${error.message}`);
    process.exit(1);
  });
