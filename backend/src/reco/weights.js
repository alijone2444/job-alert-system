/**
 * Scoring configuration — every tunable number lives here, nowhere else.
 *
 * WHY isolate this: tuning a recommender is empirical. You WILL want to say
 * "skills matter more than location" three weeks from now, and you must be
 * able to do that without reading the scorer. Weights are also overridable at
 * runtime from Firestore (`settings/scoring`), so tuning does not need a
 * redeploy.
 *
 * Weights are relative, not percentages — they are normalised by whichever
 * dimensions actually apply to a given (job, user) pair.
 */

export const DEFAULT_WEIGHTS = {
  skills: 34,
  country: 18,
  experienceLevel: 12,
  workplace: 12,
  jobType: 10,
  keywords: 8,
  salary: 6,
};

export const DEFAULT_TUNING = {
  /**
   * How many of the user's skills must a job hit for FULL skill credit.
   *
   * WHY 3 and not "all of them": a user who selects 10 skills is describing
   * their profile, not a checklist. No real posting lists 10. Requiring all
   * would make every job score ~20% and the feed would be permanently empty.
   */
  skillSaturation: 3,

  /** A skill in the TITLE is worth this much extra vs one buried in the body. */
  titleSkillBonus: 0.5,

  /**
   * Credit given when the USER expressed a preference but the JOB has no data
   * for that dimension (e.g. LinkedIn rarely publishes salary).
   *
   * WHY 0.5 and not 0: scoring a job 0 on salary because the board hides pay
   * would systematically bury LinkedIn jobs — punishing the job for the
   * source's limitations, not for being a bad match.
   */
  unknownCredit: 0.5,

  /** Unknown dimensions also count for less, so they cannot dominate. */
  unknownWeightFactor: 0.5,

  /**
   * Credit when we HAVE read a posting and found none of the ~50 canonical
   * tech skills in it. Low but non-zero: the detector is good, not perfect.
   * This is what keeps non-engineering roles out of an engineer's feed.
   */
  noSkillsDetectedCredit: 0.2,

  /** Experience-level distance -> credit. Index = |levelA - levelB|. */
  levelDistanceCredit: [1, 0.6, 0.25, 0.05, 0],

  /** A remote job outside the user's countries is still often applicable. */
  remoteOutsideCountryCredit: 0.6,

  /** Worldwide-remote listings when the user wants remote. */
  worldwideCredit: 0.85,

  /** Salary within this fraction of the user's minimum still gets partial credit. */
  salaryNearMissRatio: 0.8,
  salaryNearMissCredit: 0.6,

  /** Additive bonuses, applied after normalisation and then clamped to 100. */
  bonuses: {
    /** Posted within the last hour / 6h / 24h. */
    freshness: [
      { withinMs: 3_600_000, points: 4 },
      { withinMs: 21_600_000, points: 2 },
      { withinMs: 86_400_000, points: 1 },
    ],
    /** Company is on the user's preferred list. */
    preferredCompany: 8,
    /** Seen on 2+ boards — a real, actively-syndicated posting. */
    multiSource: 2,
  },
};

/**
 * A notification interrupts someone's day, so it has a HARD FLOOR, not just a
 * default. Nothing below this may ever trigger a push, whatever a client sends
 * — `sanitizePreferences` clamps to it. The feed is where borderline matches
 * belong; the notification tray is not.
 */
export const MIN_NOTIFY_THRESHOLD = 85;

/** Feed/notification cut-offs when a user has not chosen their own. */
export const DEFAULT_THRESHOLDS = {
  /**
   * Feed threshold. Deliberately below the 80-90 "target" band because a fresh
   * user with broad preferences would otherwise see an empty app on day one.
   * The app exposes this as a slider — raise it once the pool is warm.
   */
  feed: 70,
  /** Push notifications interrupt, so the bar is much higher. See above. */
  notify: MIN_NOTIFY_THRESHOLD,
};

/**
 * Merge runtime overrides (from Firestore `settings/scoring`) over defaults.
 * Unknown keys are ignored so a typo in the console cannot break scoring.
 */
export function resolveScoringConfig(overrides = {}) {
  const weights = { ...DEFAULT_WEIGHTS };
  for (const [key, value] of Object.entries(overrides.weights || {})) {
    if (key in weights && Number.isFinite(Number(value))) weights[key] = Number(value);
  }

  const tuning = { ...DEFAULT_TUNING, bonuses: { ...DEFAULT_TUNING.bonuses } };
  for (const [key, value] of Object.entries(overrides.tuning || {})) {
    if (key in tuning && value !== null && typeof value !== 'object') tuning[key] = value;
  }

  return { weights, tuning };
}
