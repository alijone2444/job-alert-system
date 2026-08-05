/**
 * User preferences — model, defaults and sanitisation.
 *
 * Preferences arrive from an untrusted client. Everything here is defensive:
 * unknown ids are dropped, arrays are capped, numbers are clamped. A malformed
 * preference must degrade the feed, never crash the cron or poison the store.
 *
 * DESIGN NOTE: every list field is multi-select by contract. There is no
 * single-value variant anywhere in the system — the app, the API and the
 * scorer all speak arrays, so "let the user pick more than one" can never
 * regress into "pick one".
 */

import { CURRENCIES, sanitizeIds } from './taxonomy.js';
import { DEFAULT_THRESHOLDS } from '../reco/weights.js';

/** Caps that keep a single user document bounded and queries predictable. */
const LIMITS = {
  countries: 20,
  skills: 40,
  jobTypes: 5,
  workplaces: 3,
  levels: 5,
  companies: 50,
  keywords: 30,
  keywordLength: 60,
};

/**
 * A brand-new user. Empty preference lists are INTENTIONAL: with no
 * preferences every dimension is "not applicable", the scorer returns a
 * neutral 50, and the user sees a sensible chronological feed instead of an
 * empty screen. They then narrow it down from the Personalize tab.
 */
export function defaultPreferences() {
  return {
    countries: [],
    skills: [],
    jobTypes: [],
    workplaces: [],
    levels: [],
    salary: { min: null, max: null, currency: 'USD' },
    preferredCompanies: [],
    blockedCompanies: [],
    keywordsInclude: [],
    keywordsExclude: [],
    strictCountry: false,
    feedThreshold: DEFAULT_THRESHOLDS.feed,
    notifyThreshold: DEFAULT_THRESHOLDS.notify,
    notificationsEnabled: true,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Coerce arbitrary input into a valid preferences object.
 * @param {Object} input
 * @param {Object} [base] existing preferences to patch onto
 * @returns {Object}
 */
export function sanitizePreferences(input = {}, base = defaultPreferences()) {
  const merged = { ...base, ...input };

  return {
    countries: sanitizeIds(merged.countries, 'country').slice(0, LIMITS.countries),
    skills: sanitizeIds(merged.skills, 'skill').slice(0, LIMITS.skills),
    jobTypes: sanitizeIds(merged.jobTypes, 'jobType').slice(0, LIMITS.jobTypes),
    workplaces: sanitizeIds(merged.workplaces, 'workplace').slice(0, LIMITS.workplaces),
    levels: sanitizeIds(merged.levels, 'level').slice(0, LIMITS.levels),

    salary: sanitizeSalary(merged.salary),

    preferredCompanies: sanitizeStrings(merged.preferredCompanies, LIMITS.companies),
    blockedCompanies: sanitizeStrings(merged.blockedCompanies, LIMITS.companies),
    keywordsInclude: sanitizeStrings(merged.keywordsInclude, LIMITS.keywords),
    keywordsExclude: sanitizeStrings(merged.keywordsExclude, LIMITS.keywords),

    strictCountry: Boolean(merged.strictCountry),
    feedThreshold: clampInt(merged.feedThreshold, 0, 100, DEFAULT_THRESHOLDS.feed),
    notifyThreshold: clampInt(merged.notifyThreshold, 0, 100, DEFAULT_THRESHOLDS.notify),
    notificationsEnabled: merged.notificationsEnabled !== false,

    // Bumped on every write. The cron compares this against the last-scored
    // version to detect "preferences changed -> this user needs a rescore",
    // which is how a preference edit takes effect without an extra endpoint.
    version: Number.isFinite(Number(base.version)) ? Number(base.version) + 1 : 1,
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeSalary(salary) {
  if (!salary || typeof salary !== 'object') return { min: null, max: null, currency: 'USD' };

  const min = toPositiveNumber(salary.min);
  const max = toPositiveNumber(salary.max);
  const currency = CURRENCIES.includes(String(salary.currency).toUpperCase())
    ? String(salary.currency).toUpperCase()
    : 'USD';

  // A min above the max is user error, not intent — swap rather than reject.
  if (min != null && max != null && min > max) return { min: max, max: min, currency };
  return { min, max, currency };
}

function sanitizeStrings(values, limit) {
  if (!Array.isArray(values)) return [];
  const cleaned = values
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim().slice(0, LIMITS.keywordLength))
    .filter(Boolean);
  return [...new Set(cleaned)].slice(0, limit);
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Has this user expressed ANY preference the scorer can act on?
 *
 * WHY this matters: with no preferences every dimension is "not applicable",
 * so the scorer correctly returns a neutral 50 — which sits below the default
 * feed threshold of 70, and a brand-new install would show an empty app. That
 * is the worst possible first run. Callers use this to skip the threshold
 * entirely until the user has personalised something, giving them a sensible
 * chronological feed that sharpens the moment they open the Personalize tab.
 */
export function hasAnyPreference(prefs) {
  if (!prefs) return false;
  const lists = [
    prefs.countries,
    prefs.skills,
    prefs.jobTypes,
    prefs.workplaces,
    prefs.levels,
    prefs.keywordsInclude,
    prefs.preferredCompanies,
  ];
  if (lists.some((list) => Array.isArray(list) && list.length > 0)) return true;
  return Boolean(prefs.salary?.min);
}

/**
 * Has anything that affects SCORING changed? Threshold-only edits still need a
 * rescore (they change what is visible), but cosmetic fields like
 * `notificationsEnabled` do not.
 */
export function affectsScoring(before, after) {
  const keys = [
    'countries',
    'skills',
    'jobTypes',
    'workplaces',
    'levels',
    'preferredCompanies',
    'blockedCompanies',
    'keywordsInclude',
    'keywordsExclude',
    'strictCountry',
    'feedThreshold',
  ];
  for (const key of keys) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) return true;
  }
  return JSON.stringify(before?.salary) !== JSON.stringify(after?.salary);
}
