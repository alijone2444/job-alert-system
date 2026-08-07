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
 *
 * ---------------------------------------------------------------------------
 * READ BUDGET. Firestore's free tier allows 50,000 document reads per DAY, and
 * this function runs 720 times a day. That is a budget of ~70 reads per run for
 * the entire system, so every query here is deliberate:
 *
 *   - Users and preferences are passed IN, not re-read (the engine already has
 *     them; reading them twice doubled the fixed cost of every run).
 *   - Hidden-job keys are fetched only for users who actually have something to
 *     score this run.
 *   - Feed membership is NOT checked in the incremental path: a job that is new
 *     to the `jobs` collection has never been scored, so it cannot already be
 *     in anyone's feed. That inference removed ~250 reads per run.
 *   - Trimming is driven by a count the caller already knows.
 * ---------------------------------------------------------------------------
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

function needsRebuild(user) {
  return (user.prefsVersion ?? 0) !== (user.lastScoredPrefsVersion ?? -1);
}

/**
 * @param {Object} options
 * @param {Object[]} options.newJobs        Jobs first seen this run.
 * @param {Object}   options.scoringConfig  {weights, tuning}
 * @param {Object}   options.budget
 * @param {Object[]} [options.users]        Pre-loaded, to avoid a second read.
 * @param {Map}      [options.preferences]  Pre-loaded, likewise.
 * @param {boolean}  [options.notify]       Master switch for push.
 * @returns {Promise<Object>} stats
 */
export async function fanOut({
  newJobs,
  scoringConfig,
  budget,
  users: preloadedUsers = null,
  preferences: preloadedPreferences = null,
  notify = true,
}) {
  const users = preloadedUsers ?? (await usersRepo.listUsers());
  if (!users.length) {
    log.warn('no registered users — nothing to fan out to');
    return { users: 0, entriesWritten: 0, notificationsSent: 0, rebuilds: 0 };
  }

  const rebuildQueue = users.filter(needsRebuild);

  /**
   * The overwhelming majority of runs find nothing new and nobody to rebuild.
   * Returning here keeps a quiet run at ZERO reads, which is what makes 720
   * runs a day affordable at all.
   */
  if (!newJobs.length && !rebuildQueue.length) {
    log.debug('nothing to fan out');
    return { users: users.length, entriesWritten: 0, notificationsSent: 0, rebuilds: 0, idle: true };
  }

  const userIds = users.map((user) => user.userId);
  const preferencesByUser = preloadedPreferences ?? (await usersRepo.getPreferencesForUsers(userIds));

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
    const rebuilding = needsRebuild(user);

    // Nothing new AND no rebuild -> this user costs nothing this run.
    if (!rebuilding && !newJobs.length) continue;

    let candidates = newJobs;
    if (rebuilding) {
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

    // Fetched per user, but only for users with work to do.
    const hidden = await interactionsRepo.getHiddenKeys(user.userId);

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
      if (rebuilding) await usersRepo.markScored(user.userId, user.prefsVersion ?? 0);
      continue;
    }

    /* ------------------------------ write ------------------------------ */
    await feedRepo.writeEntries(user.userId, matches);
    entriesWritten += matches.length;

    /* ---------------------------- notify ------------------------------- */
    /**
     * No feed-membership check needed. These jobs were first seen in the
     * `jobs` collection THIS run, so they have never been scored for anyone
     * and cannot already be in this user's feed. The check that used to be
     * here cost ~50 reads per user per run and told us something we could
     * already prove.
     */
    if (notify && !rebuilding && prefs.notificationsEnabled && user.fcmToken) {
      const notifiable = matches.filter((match) => match.result.score >= prefs.notifyThreshold);
      if (notifiable.length) {
        deliveries.push({ userId: user.userId, token: user.fcmToken, matches: notifiable });
      }
    }

    if (rebuilding) {
      // The feed was cleared first, so what we just wrote IS its whole size.
      await feedRepo.trimFeed(user.userId, { expectedSize: matches.length });
      await usersRepo.markScored(user.userId, user.prefsVersion ?? 0);
    } else {
      /**
       * Incremental runs also have to trim. The previous version trimmed only
       * on rebuild, on the assumption that "an incremental run adds a handful"
       * — true per run, but there are 720 of them a day, and handfuls
       * accumulate. Live feeds had reached 613 entries against a cap of 300.
       *
       * The count() aggregate is billed at roughly one read per 1,000 documents
       * rather than one per document, and this only runs on the rare cycle that
       * actually wrote something.
       */
      const size = await feedRepo.countFeed(user.userId);
      if (size !== null) await feedRepo.trimFeed(user.userId, { expectedSize: size });
    }
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
 * Rebuild ONE user's feed on demand — powers `POST /api/rescore` and the
 * preference-save path, so the Personalize screen shows results immediately
 * instead of waiting up to two minutes for the next cron tick.
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
  await feedRepo.trimFeed(userId, { expectedSize: matches.length });
  await usersRepo.markScored(userId, prefs.version ?? 0);

  log.info('feed rebuilt on demand', { userId, scanned: candidates.length, matched: matches.length });
  return { matched: matches.length, scanned: candidates.length };
}
