/**
 * The recommendation engine.
 *
 * `scoreJob(job, preferences, config)` is a PURE function: same inputs, same
 * output, no I/O, no clock reads other than the one passed in. That is a
 * deliberate architectural constraint, and the most important one in this file.
 *
 * WHY pure matters here:
 *   - It can run at INGEST time (fan-out-on-write, what we do today) or at
 *     QUERY time (fan-out-on-read, what we will need past ~10k users) without
 *     a single line changing. The storage strategy becomes swappable.
 *   - It is unit-testable without Firebase.
 *   - It can be ported to the client verbatim for offline re-ranking.
 *
 * ---------------------------------------------------------------------------
 * THE SCORING MODEL: coverage-weighted, not fixed-denominator.
 *
 * The naive approach — sum every dimension out of a fixed total — fails badly
 * here, in both directions:
 *
 *   - A user who only cares about skills gets punished on 6 dimensions they
 *     never expressed an opinion about. Nothing ever reaches 80%.
 *   - A LinkedIn job with no published salary scores 0 on salary, so the
 *     richest source of fresh jobs is systematically ranked last.
 *
 * So each dimension resolves to one of three states:
 *
 *   NOT_APPLICABLE  user expressed no preference -> removed from the
 *                   denominator entirely. Costs the job nothing.
 *   UNKNOWN         user cares, but the job has no data -> neutral credit at
 *                   reduced weight. Softly lowers confidence; never fatal.
 *   SCORED          both sides have data -> real 0..1 credit at full weight.
 *
 * score = 100 * Σ(weight × credit) / Σ(weight)   over applicable dimensions
 *
 * This is what makes a genuine 80-90% threshold usable instead of aspirational.
 * ---------------------------------------------------------------------------
 */

import { LEVEL_ORDER, COUNTRY_WORLDWIDE, WORKPLACE, toAnnualUsd } from '../core/taxonomy.js';
import { DEFAULT_TUNING, DEFAULT_WEIGHTS } from './weights.js';

const NOT_APPLICABLE = Symbol('not_applicable');
const UNKNOWN = Symbol('unknown');

/**
 * @typedef {Object} Preferences
 * @property {string[]} countries
 * @property {string[]} skills
 * @property {string[]} jobTypes
 * @property {string[]} workplaces
 * @property {string[]} levels
 * @property {{min:number|null,max:number|null,currency:string}} salary
 * @property {string[]} preferredCompanies
 * @property {string[]} blockedCompanies
 * @property {string[]} keywordsInclude
 * @property {string[]} keywordsExclude
 * @property {boolean}  strictCountry
 */

/**
 * @typedef {Object} ScoreResult
 * @property {number}  score        0-100
 * @property {boolean} rejected     Hard-filtered; never show regardless of score.
 * @property {string|null} rejectReason
 * @property {Object}  breakdown    Per-dimension {weight, credit, state, detail}
 * @property {string[]} matchedSkills
 * @property {string[]} reasons     Human-readable, shown in the app.
 */

/* -------------------------------------------------------------------------- */
/*                                HARD FILTERS                                 */
/* -------------------------------------------------------------------------- */

/**
 * Rules that are absolute. A blocked company is blocked at 100% relevance —
 * these are the user's vetoes, and no amount of skill overlap overrides them.
 * Applied before scoring so we never waste work on a job we cannot show.
 */
function applyHardFilters(job, prefs) {
  const companyNorm = job.companyNorm || '';
  for (const blocked of prefs.blockedCompanies || []) {
    const needle = String(blocked).toLowerCase().trim();
    if (needle && companyNorm.includes(needle)) {
      return `Blocked company: ${blocked}`;
    }
  }

  const haystack = `${job.title} ${job.description || ''}`.toLowerCase();
  for (const excluded of prefs.keywordsExclude || []) {
    const needle = String(excluded).toLowerCase().trim();
    if (needle && haystack.includes(needle)) {
      return `Excluded keyword: ${excluded}`;
    }
  }

  // Opt-in strictness: only reject on country when the user explicitly asked.
  if (prefs.strictCountry && prefs.countries?.length && job.country) {
    const isWorldwide = job.country === COUNTRY_WORLDWIDE;
    const isRemote = job.workplace === WORKPLACE.REMOTE;
    if (!isWorldwide && !isRemote && !prefs.countries.includes(job.country)) {
      return `Outside selected countries (${job.country})`;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*                                 DIMENSIONS                                  */
/* -------------------------------------------------------------------------- */

/**
 * Skills — the heaviest dimension, and the only one with partial credit that
 * scales with how many of the user's skills a job hits.
 */
function scoreSkills(job, prefs, tuning) {
  const wanted = prefs.skills || [];
  if (!wanted.length) return { credit: NOT_APPLICABLE };

  if (!job.skills?.length) {
    /**
     * Two very different situations look identical here, and conflating them
     * was a real bug: a "Senior Compliance Analyst" scored 85% for a MERN
     * developer purely because it was senior, remote and in-country, while its
     * complete absence of tech skills was scored as a neutral "unknown".
     *
     *  - We HAVE read the posting body and found none of ~50 canonical tech
     *    skills -> that is evidence, not ignorance. It is very likely not a
     *    tech role. Score it low, at full weight.
     *  - We have NOT read the body yet (a LinkedIn card awaiting enrichment)
     *    -> genuinely unknown. Stay neutral; the next run will enrich it.
     */
    const looked = job.enriched || (job.description?.length || 0) > 200;
    return looked
      ? { credit: tuning.noSkillsDetectedCredit, detail: 'no relevant skills in posting', matched: [] }
      : { credit: UNKNOWN, detail: 'posting not yet enriched' };
  }

  const wantedSet = new Set(wanted);
  const matched = job.skills.filter((skill) => wantedSet.has(skill));
  if (!matched.length) return { credit: 0, detail: 'no overlap', matched: [] };

  // A skill named in the title is a much stronger signal than one that appears
  // once in a 3000-word "nice to have" list.
  const titleLower = (job.title || '').toLowerCase();
  const inTitle = matched.filter((skill) => titleLower.includes(skill.replace(/_/g, ' ')));

  const effective = matched.length + inTitle.length * tuning.titleSkillBonus;
  const saturation = Math.min(tuning.skillSaturation, wanted.length);
  const credit = Math.min(1, effective / saturation);

  return { credit, matched, detail: `${matched.length}/${wanted.length} skills` };
}

function scoreCountry(job, prefs, tuning) {
  const wanted = prefs.countries || [];
  if (!wanted.length) return { credit: NOT_APPLICABLE };
  if (!job.country) return { credit: UNKNOWN, detail: 'location unknown' };

  if (wanted.includes(job.country)) return { credit: 1, detail: job.country };

  // A worldwide-remote listing is genuinely open to the user's country.
  if (job.country === COUNTRY_WORLDWIDE) {
    return { credit: tuning.worldwideCredit, detail: 'worldwide remote' };
  }
  // A remote job posted elsewhere is often still applicable.
  if (job.workplace === WORKPLACE.REMOTE) {
    return { credit: tuning.remoteOutsideCountryCredit, detail: 'remote, other country' };
  }
  return { credit: 0, detail: `${job.country} not selected` };
}

function scoreWorkplace(job, prefs) {
  const wanted = prefs.workplaces || [];
  if (!wanted.length) return { credit: NOT_APPLICABLE };
  if (!job.workplace) return { credit: UNKNOWN, detail: 'not stated' };
  return wanted.includes(job.workplace)
    ? { credit: 1, detail: job.workplace }
    : { credit: 0, detail: `${job.workplace} not selected` };
}

function scoreJobType(job, prefs) {
  const wanted = prefs.jobTypes || [];
  if (!wanted.length) return { credit: NOT_APPLICABLE };
  if (!job.jobType) return { credit: UNKNOWN, detail: 'not stated' };
  return wanted.includes(job.jobType)
    ? { credit: 1, detail: job.jobType }
    : { credit: 0, detail: `${job.jobType} not selected` };
}

/**
 * Experience level uses DISTANCE, not equality.
 *
 * WHY: a "mid" candidate looking at a "senior" posting is a near-miss worth
 * showing; the same candidate looking at a "lead" role is not. Binary matching
 * throws away that ordering and makes the feed feel arbitrary.
 */
function scoreLevel(job, prefs, tuning) {
  const wanted = prefs.levels || [];
  if (!wanted.length) return { credit: NOT_APPLICABLE };
  if (!job.experienceLevel) return { credit: UNKNOWN, detail: 'not stated' };

  const jobIndex = LEVEL_ORDER.indexOf(job.experienceLevel);
  if (jobIndex === -1) return { credit: UNKNOWN, detail: 'unrecognised level' };

  let best = 0;
  for (const level of wanted) {
    const wantedIndex = LEVEL_ORDER.indexOf(level);
    if (wantedIndex === -1) continue;
    const distance = Math.abs(wantedIndex - jobIndex);
    const credit = tuning.levelDistanceCredit[distance] ?? 0;
    if (credit > best) best = credit;
  }

  return { credit: best, detail: job.experienceLevel };
}

function scoreKeywords(job, prefs) {
  const wanted = (prefs.keywordsInclude || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean);
  if (!wanted.length) return { credit: NOT_APPLICABLE };

  const haystack = `${job.title} ${job.company} ${job.description || ''}`.toLowerCase();
  const hits = wanted.filter((keyword) => haystack.includes(keyword));
  if (!hits.length) return { credit: 0, detail: 'no keyword match' };

  return { credit: Math.min(1, hits.length / Math.min(2, wanted.length)), detail: hits.join(', ') };
}

function scoreSalary(job, prefs, tuning) {
  const minimum = prefs.salary?.min;
  if (!minimum || !Number.isFinite(Number(minimum))) return { credit: NOT_APPLICABLE };

  const jobAnnualUsd = job.salaryAnnualUsd ?? toAnnualUsd(job.salary);
  if (!jobAnnualUsd) return { credit: UNKNOWN, detail: 'salary not published' };

  // Compare like for like: the user's figure is annual in their own currency.
  const wantedUsd = toAnnualUsd({
    min: Number(minimum),
    max: Number(minimum),
    currency: prefs.salary?.currency || 'USD',
    period: 'year',
  });

  if (jobAnnualUsd >= wantedUsd) return { credit: 1, detail: 'meets minimum' };
  if (jobAnnualUsd >= wantedUsd * tuning.salaryNearMissRatio) {
    return { credit: tuning.salaryNearMissCredit, detail: 'slightly below minimum' };
  }
  return { credit: 0, detail: 'below minimum' };
}

/* -------------------------------------------------------------------------- */
/*                                   BONUSES                                   */
/* -------------------------------------------------------------------------- */

function computeBonuses(job, prefs, tuning, nowMs) {
  const bonuses = [];
  const config = tuning.bonuses;

  const ageMs = nowMs - new Date(job.postedAt).getTime();
  if (Number.isFinite(ageMs) && ageMs >= 0) {
    for (const tier of config.freshness) {
      if (ageMs <= tier.withinMs) {
        bonuses.push({ label: 'Fresh posting', points: tier.points });
        break;
      }
    }
  }

  const companyNorm = job.companyNorm || '';
  const preferred = (prefs.preferredCompanies || []).find((company) => {
    const needle = String(company).toLowerCase().trim();
    return needle && companyNorm.includes(needle);
  });
  if (preferred) bonuses.push({ label: `Preferred company: ${preferred}`, points: config.preferredCompany });

  if ((job.seenInSources?.length || 1) > 1) {
    bonuses.push({ label: 'Posted on multiple boards', points: config.multiSource });
  }

  return bonuses;
}

/* -------------------------------------------------------------------------- */
/*                                 PUBLIC API                                  */
/* -------------------------------------------------------------------------- */

/**
 * Score one job against one user's preferences.
 *
 * @param {import('../core/normalizedJob.js').NormalizedJob} job
 * @param {Preferences} prefs
 * @param {{weights?:Object, tuning?:Object, nowMs?:number}} [config]
 * @returns {ScoreResult}
 */
export function scoreJob(job, prefs, config = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };
  const tuning = { ...DEFAULT_TUNING, ...(config.tuning || {}) };
  const nowMs = config.nowMs ?? Date.now();

  const rejectReason = applyHardFilters(job, prefs);
  if (rejectReason) {
    return {
      score: 0,
      rejected: true,
      rejectReason,
      breakdown: {},
      matchedSkills: [],
      reasons: [rejectReason],
    };
  }

  const dimensions = {
    skills: scoreSkills(job, prefs, tuning),
    country: scoreCountry(job, prefs, tuning),
    experienceLevel: scoreLevel(job, prefs, tuning),
    workplace: scoreWorkplace(job, prefs),
    jobType: scoreJobType(job, prefs),
    keywords: scoreKeywords(job, prefs),
    salary: scoreSalary(job, prefs, tuning),
  };

  let weightedSum = 0;
  let weightTotal = 0;
  const breakdown = {};

  for (const [name, result] of Object.entries(dimensions)) {
    const baseWeight = weights[name] ?? 0;

    if (result.credit === NOT_APPLICABLE) {
      breakdown[name] = { state: 'not_applicable', weight: 0, credit: null, detail: 'no preference set' };
      continue;
    }

    if (result.credit === UNKNOWN) {
      const weight = baseWeight * tuning.unknownWeightFactor;
      weightedSum += weight * tuning.unknownCredit;
      weightTotal += weight;
      breakdown[name] = {
        state: 'unknown',
        weight: round(weight),
        credit: tuning.unknownCredit,
        detail: result.detail || 'no data',
      };
      continue;
    }

    weightedSum += baseWeight * result.credit;
    weightTotal += baseWeight;
    breakdown[name] = {
      state: 'scored',
      weight: baseWeight,
      credit: round(result.credit),
      detail: result.detail || '',
    };
  }

  /**
   * No applicable dimensions = the user has set no preferences at all. Return a
   * neutral 50 rather than 0 or 100: a brand-new user should see a reasonable
   * chronological feed, not an empty screen and not every job ranked perfect.
   */
  const base = weightTotal > 0 ? (100 * weightedSum) / weightTotal : 50;

  const bonuses = computeBonuses(job, prefs, tuning, nowMs);
  const bonusPoints = bonuses.reduce((sum, bonus) => sum + bonus.points, 0);
  const score = clamp(Math.round(base + bonusPoints), 0, 100);

  return {
    score,
    rejected: false,
    rejectReason: null,
    breakdown,
    matchedSkills: dimensions.skills.matched || [],
    reasons: buildReasons(dimensions, bonuses, breakdown),
    bonuses,
    baseScore: Math.round(base),
  };
}

/**
 * Turn the numeric breakdown into the short human lines the app shows under
 * "Why this matched". Explainability is a product feature, not a debug tool —
 * a user who cannot see WHY a job matched will not trust the percentage.
 */
function buildReasons(dimensions, bonuses, breakdown) {
  const reasons = [];

  const matched = dimensions.skills.matched;
  if (matched?.length) reasons.push(`Matches ${matched.length} of your skills`);

  if (breakdown.country?.state === 'scored' && breakdown.country.credit >= 0.85) {
    reasons.push(`Located in ${breakdown.country.detail}`);
  }
  if (breakdown.workplace?.state === 'scored' && breakdown.workplace.credit === 1) {
    reasons.push(`${capitalise(breakdown.workplace.detail)} role`);
  }
  if (breakdown.jobType?.state === 'scored' && breakdown.jobType.credit === 1) {
    reasons.push(`${labelJobType(breakdown.jobType.detail)} position`);
  }
  if (breakdown.experienceLevel?.state === 'scored' && breakdown.experienceLevel.credit >= 0.9) {
    reasons.push(`${capitalise(breakdown.experienceLevel.detail)}-level match`);
  }
  if (breakdown.salary?.state === 'scored' && breakdown.salary.credit === 1) {
    reasons.push('Meets your salary minimum');
  }

  for (const bonus of bonuses) reasons.push(bonus.label);

  return reasons.slice(0, 5);
}

/**
 * Rank an array of jobs for one user. Convenience wrapper used by both the
 * ingest fan-out and the read-time API path.
 *
 * @returns {Array<{job:Object, result:ScoreResult}>} sorted, threshold-filtered
 */
export function rankJobs(jobs, prefs, { threshold = 0, config = {}, limit = Infinity } = {}) {
  const ranked = [];

  for (const job of jobs) {
    const result = scoreJob(job, prefs, config);
    if (result.rejected || result.score < threshold) continue;
    ranked.push({ job, result });
  }

  ranked.sort((a, b) => {
    if (b.result.score !== a.result.score) return b.result.score - a.result.score;
    // Equal relevance -> fresher first. Recency is the tie-breaker, never the
    // primary sort; that is the difference between a feed and a firehose.
    return new Date(b.job.postedAt) - new Date(a.job.postedAt);
  });

  return ranked.slice(0, limit);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function capitalise(value) {
  return String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);
}

function labelJobType(value) {
  return capitalise(String(value || '').replace(/_/g, '-'));
}
