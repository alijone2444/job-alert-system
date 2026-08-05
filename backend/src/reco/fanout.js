/**
 * Fan-out: turn "new jobs exist" into "each user's personalised feed".
 *
 * This is where the pure scorer meets storage. It handles two distinct paths,
 * and keeping them distinct is what makes the feature feel correct:
 *
 *  INCREMENTAL  The normal 2-minute case. Score only the jobs that arrived this
 *               run against every user. Cheap. Can produce notifications.
 *
 *  REBUILD      The user changed their preferences. Their existing feed was
 *               scored against the OLD preferences and is now wrong, so we wipe
 *               it and rescore the whole recent window. Deliberately produces
 *               NO notifications — the user is looking at the app right now,
 *               and buzzing their phone 40 times because they ticked "Remote"
 *               would be indefensible.
 */

import { createLogger } from '../core/logger.js';
import { scoreJob } from './scorer.js';
import { hasAnyPreference } from '../core/preferences.js';
import * as usersRepo from '../repositories/usersRepo.js';
import * as feedRepo from '../repositories/feedRepo.js';
import * as jobsRepo from '../repositories/jobsRepo.js';
import * as interactionsRepo from '../repositories/interactionsRepo.js';
import { notifyUsers } from '../services/pushNotifications.js';

const log = createLogger('Fanout');

/** How far back a full rebuild looks. */
const REBUILD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REBUILD_CANDIDATE_LIMIT = 400;

/**
 * @param {Object} options
 * @param {Object[]} options.newJobs      Jobs first seen this run.
 * @param {Object}   options.scoringConfig {weights, tuning}
 * @param {Object}   options.budget
 * @param {boolean}  [options.notify]     Master switch for push.
 * @returns {Promise<Object>} stats
 */
export async function fanOut({ newJobs, scoringConfig, budget, notify = true }) {
  const users = await usersRepo.listUsers();
  if (!users.length) {
    log.warn('no registered users — nothing to fan out to');
    return { users: 0, entriesWritten: 0, notificationsSent: 0, rebuilds: 0 };
  }

  const userIds = users.map((user) => user.userId);
  const preferencesByUser = await usersRepo.getPreferencesForUsers(userIds);
  const hiddenByUser = await interactionsRepo.getHiddenKeysForUsers(userIds);

  // Only loaded if at least one user actually needs a rebuild — it is by far
  // the most expensive read in the run.
  let rebuildPool = null;

  const deliveries = [];
  let entriesWritten = 0;
  let rebuilds = 0;

  for (const user of users) {
    // Always serve at least one user per run. Checking the budget before any
    // work meant a slow ingest could starve fan-out entirely and every feed
    // would stay empty forever; with this, the queue drains across runs.
    if (users.indexOf(user) > 0 && budget.expired(2_000)) {
      log.warn('budget exhausted — remaining users will be served next run', {
        remaining: users.length - users.indexOf(user),
      });
      break;
    }

    const prefs = preferencesByUser.get(user.userId);
    const hidden = hiddenByUser.get(user.userId) || new Set();
    const needsRebuild = (user.prefsVersion ?? 0) !== (user.lastScoredPrefsVersion ?? -1);

    let candidates = newJobs;
    if (needsRebuild) {
      if (!rebuildPool) {
        rebuildPool = await jobsRepo.findRecent({
          sinceMs: REBUILD_WINDOW_MS,
          limit: REBUILD_CANDIDATE_LIMIT,
        });
      }
      await feedRepo.clearFeed(user.userId);
      candidates = rebuildPool;
      rebuilds++;
      log.info('rebuilding feed after preference change', {
        userId: user.userId,
        version: user.prefsVersion,
        candidates: candidates.length,
      });
    }

    /* ------------------------------ score ------------------------------ */
    // A user who has not personalised anything gets an unfiltered feed rather
    // than an empty one — see hasAnyPreference() for the reasoning.
    const threshold = hasAnyPreference(prefs) ? prefs.feedThreshold : 0;

    const matches = [];
    for (const job of candidates) {
      if (hidden.has(job.jobKey)) continue; // a dismissal must survive rescoring

      const result = scoreJob(job, prefs, scoringConfig);
      if (result.rejected || result.score < threshold) continue;
      matches.push({ job, result });
    }

    if (!matches.length) {
      if (needsRebuild) await usersRepo.markScored(user.userId, user.prefsVersion ?? 0);
      continue;
    }

    /* ------------------------------ write ------------------------------ */
    // Which of these are genuinely new TO THIS USER? Checked before writing,
    // because writing is what makes them look old.
    const alreadyInFeed = await feedRepo.findExistingKeys(
      user.userId,
      matches.map((match) => match.job.jobKey)
    );

    await feedRepo.writeEntries(user.userId, matches);
    entriesWritten += matches.length;

    /* ---------------------------- notify ------------------------------- */
    if (notify && !needsRebuild && prefs.notificationsEnabled && user.fcmToken) {
      const notifiable = matches.filter(
        (match) =>
          !alreadyInFeed.has(match.job.jobKey) && match.result.score >= prefs.notifyThreshold
      );

      if (notifiable.length) {
        deliveries.push({ userId: user.userId, token: user.fcmToken, matches: notifiable });
      }
    }

    await feedRepo.trimFeed(user.userId);
    if (needsRebuild) await usersRepo.markScored(user.userId, user.prefsVersion ?? 0);
  }

  /* ------------------------------- push -------------------------------- */
  let notificationsSent = 0;
  if (deliveries.length) {
    const result = await notifyUsers(deliveries);
    notificationsSent = result.sent;

    for (const delivery of deliveries) {
      await feedRepo.markNotified(
        delivery.userId,
        delivery.matches.map((match) => match.job.jobKey)
      );
    }
  }

  const stats = {
    users: users.length,
    entriesWritten,
    notificationsSent,
    rebuilds,
    usersNotified: deliveries.length,
  };
  log.info('fan-out complete', stats);
  return stats;
}

/**
 * Rebuild ONE user's feed on demand — powers `POST /api/rescore`, so the
 * Personalize screen can show results immediately instead of waiting up to two
 * minutes for the next cron tick.
 *
 * @returns {Promise<{matched:number, scanned:number}>}
 */
export async function rebuildUserFeed(userId, { scoringConfig, windowMs = REBUILD_WINDOW_MS }) {
  const prefs = await usersRepo.getPreferences(userId);
  const hidden = await interactionsRepo.getHiddenKeys(userId);
  const candidates = await jobsRepo.findRecent({ sinceMs: windowMs, limit: REBUILD_CANDIDATE_LIMIT });
  const threshold = hasAnyPreference(prefs) ? prefs.feedThreshold : 0;

  const matches = [];
  for (const job of candidates) {
    if (hidden.has(job.jobKey)) continue;
    const result = scoreJob(job, prefs, scoringConfig);
    if (result.rejected || result.score < threshold) continue;
    matches.push({ job, result });
  }

  await feedRepo.clearFeed(userId);
  await feedRepo.writeEntries(userId, matches);
  await feedRepo.trimFeed(userId);
  await usersRepo.markScored(userId, prefs.version ?? 0);

  log.info('feed rebuilt on demand', { userId, scanned: candidates.length, matched: matches.length });
  return { matched: matches.length, scanned: candidates.length };
}
