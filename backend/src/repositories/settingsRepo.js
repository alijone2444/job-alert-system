/**
 * System-wide settings and source telemetry.
 *
 *   settings/scoring   runtime weight overrides (tune without a redeploy)
 *   settings/ingest    fetch window + per-source limits
 *   sources/{id}       last-run health per board, surfaced on the Status screen
 */

import admin from 'firebase-admin';
import { getFirestore } from '../firebase/admin.js';
import { createLogger } from '../core/logger.js';
import { resolveScoringConfig } from '../reco/weights.js';

const log = createLogger('SettingsRepo');

export const DEFAULT_INGEST_SETTINGS = {
  /**
   * How far back each source looks, unless the adapter narrows it further.
   *
   * BACK TO 24 HOURS, and the reason it was ever cut to 3 is worth recording.
   *
   * Cutting it looked free: with a 2-minute cron, re-fetching a full day of
   * postings 720 times is obviously redundant, and every re-fetched job costs a
   * Firestore read in the "have we seen this?" check. That reasoning holds for
   * LinkedIn, which filters by date SERVER-side and is polled constantly.
   *
   * It is wrong for every other source. Greenhouse, Lever, Ashby, RemoteOK and
   * We Work Remotely have no date parameter at all — they return a whole board
   * and we filter locally. Worse, the ATS boards are polled by ROTATION, two or
   * three company slugs per run. So a job only survives if it was posted inside
   * the window that happened to be open when its slug came up. With a 3-hour
   * window that is a lottery, and the pipeline collapsed from ~60 jobs a run to
   * FIVE, with four of six sources returning zero.
   *
   * The window is a catch-up window for a date-sorted feed; for a rotated,
   * unsorted board it is the entire visibility budget. Per-source now: see
   * `maxSinceMs` on the LinkedIn adapter.
   */
  freshnessWindowMs: Number(process.env.FRESHNESS_WINDOW_MS) || 24 * 60 * 60 * 1000,
  /** Per-source cap per run — keeps one chatty board from starving the others. */
  maxJobsPerSource: 60,
  /** LinkedIn detail requests per run (rate-limit budget). */
  maxEnrichPerRun: 12,
  /** Delete jobs older than this. */
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  /**
   * Wall-clock ceiling for one cron invocation.
   *
   * Set below the platform's function timeout on purpose: an overrun on Vercel
   * is a hard kill that persists nothing, so we would rather do 80% of the work
   * and save it than 100% and lose it. Board rotation means whatever this run
   * skipped is picked up by the next one, two minutes later.
   */
  runBudgetMs: Number(process.env.RUN_BUDGET_MS) || 45_000,
};

/**
 * Scoring config with Firestore overrides applied.
 * Never throws — a broken settings doc must not stop the cron, so failures fall
 * back to the compiled-in defaults.
 */
export async function getScoringConfig() {
  try {
    const snapshot = await getFirestore().doc('settings/scoring').get();
    return resolveScoringConfig(snapshot.exists ? snapshot.data() : {});
  } catch (error) {
    log.warn('could not read scoring settings, using defaults', { error: error.message });
    return resolveScoringConfig({});
  }
}

export async function getIngestSettings() {
  try {
    const snapshot = await getFirestore().doc('settings/ingest').get();
    const overrides = snapshot.exists ? snapshot.data() : {};
    const settings = { ...DEFAULT_INGEST_SETTINGS };

    for (const [key, value] of Object.entries(overrides)) {
      if (key in settings && Number.isFinite(Number(value))) settings[key] = Number(value);
    }
    return settings;
  } catch (error) {
    log.warn('could not read ingest settings, using defaults', { error: error.message });
    return { ...DEFAULT_INGEST_SETTINGS };
  }
}

/**
 * The union of every user's country preferences.
 *
 * WHY: LinkedIn is the one source that can filter by country server-side, and
 * querying every country in the taxonomy would waste most of the run. Fetching
 * only the countries at least one user actually cares about keeps the run fast
 * while guaranteeing nobody's preference goes unserved.
 */
export async function getActiveCountries(preferencesByUser) {
  const countries = new Set();
  for (const prefs of preferencesByUser.values()) {
    for (const country of prefs.countries || []) countries.add(country);
  }
  return [...countries];
}

/** Record how a source performed this run — powers the Status screen. */
export async function recordSourceHealth(sourceId, health) {
  try {
    await getFirestore()
      .collection('sources')
      .doc(sourceId)
      .set(
        { ...health, sourceId, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
  } catch (error) {
    log.debug('could not record source health', { sourceId, error: error.message });
  }
}

export async function listSourceHealth() {
  try {
    const snapshot = await getFirestore().collection('sources').get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch {
    return [];
  }
}
