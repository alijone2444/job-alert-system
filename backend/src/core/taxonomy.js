/**
 * Canonical vocabularies — the single source of truth for every enum the
 * system understands.
 *
 * WHY this file exists: sources disagree about everything. LinkedIn says
 * "Mid-Senior level", Greenhouse says "L4", Ashby says "FullTime", RemoteOK
 * says "full_time". If each adapter invents its own strings the recommendation
 * engine can never match a user preference against a job. So every adapter is
 * required to map its raw values into THESE canonical ids, and the scorer only
 * ever compares canonical ids.
 *
 * The mobile app mirrors this file (mobile/src/domain/taxonomy.ts). Keep them
 * in sync — `npm run taxonomy:check` in backend/ verifies the ids match.
 */

/* -------------------------------------------------------------------------- */
/*                                  WORKPLACE                                  */
/* -------------------------------------------------------------------------- */

export const WORKPLACE = {
  REMOTE: 'remote',
  HYBRID: 'hybrid',
  ONSITE: 'onsite',
};

export const WORKPLACES = [
  { id: WORKPLACE.REMOTE, label: 'Remote' },
  { id: WORKPLACE.HYBRID, label: 'Hybrid' },
  { id: WORKPLACE.ONSITE, label: 'On-site' },
];

/** Phrases that imply a workplace mode, most-specific group first. */
const WORKPLACE_PATTERNS = [
  [WORKPLACE.HYBRID, ['hybrid', 'partially remote', 'part remote', 'flexible onsite']],
  [
    WORKPLACE.REMOTE,
    [
      'fully remote',
      'work from home',
      'work-from-home',
      'wfh',
      'remote-first',
      'remote first',
      '100% remote',
      'telecommute',
      'distributed team',
      'remote',
      'remotely',
    ],
  ],
  [
    WORKPLACE.ONSITE,
    ['on-site', 'onsite', 'on site', 'in-office', 'in office', 'in-person', 'office based'],
  ],
];

/* -------------------------------------------------------------------------- */
/*                                   JOB TYPE                                  */
/* -------------------------------------------------------------------------- */

export const JOB_TYPE = {
  FULL_TIME: 'full_time',
  PART_TIME: 'part_time',
  CONTRACT: 'contract',
  INTERNSHIP: 'internship',
  FREELANCE: 'freelance',
};

export const JOB_TYPES = [
  { id: JOB_TYPE.FULL_TIME, label: 'Full-time' },
  { id: JOB_TYPE.PART_TIME, label: 'Part-time' },
  { id: JOB_TYPE.CONTRACT, label: 'Contract' },
  { id: JOB_TYPE.INTERNSHIP, label: 'Internship' },
  { id: JOB_TYPE.FREELANCE, label: 'Freelance' },
];

const JOB_TYPE_PATTERNS = [
  [JOB_TYPE.INTERNSHIP, ['internship', 'intern', 'trainee', 'apprentice', 'co-op']],
  [JOB_TYPE.FREELANCE, ['freelance', 'freelancer', 'per project', 'project based']],
  [
    JOB_TYPE.CONTRACT,
    ['contract', 'contractor', 'c2c', 'corp to corp', 'temporary', 'fixed term', 'b2b'],
  ],
  [JOB_TYPE.PART_TIME, ['part-time', 'part time', 'parttime']],
  [JOB_TYPE.FULL_TIME, ['full-time', 'full time', 'fulltime', 'permanent']],
];

/* -------------------------------------------------------------------------- */
/*                              EXPERIENCE LEVEL                               */
/* -------------------------------------------------------------------------- */

export const LEVEL = {
  ENTRY: 'entry',
  JUNIOR: 'junior',
  MID: 'mid',
  SENIOR: 'senior',
  LEAD: 'lead',
};

/** Ordered weakest -> strongest. The scorer uses the index for distance. */
export const LEVEL_ORDER = [LEVEL.ENTRY, LEVEL.JUNIOR, LEVEL.MID, LEVEL.SENIOR, LEVEL.LEAD];

export const LEVELS = [
  { id: LEVEL.ENTRY, label: 'Entry' },
  { id: LEVEL.JUNIOR, label: 'Junior' },
  { id: LEVEL.MID, label: 'Mid' },
  { id: LEVEL.SENIOR, label: 'Senior' },
  { id: LEVEL.LEAD, label: 'Lead' },
];

/**
 * Seniority phrases. Deliberately CONSERVATIVE — "manager" and "leadership"
 * are excluded because they appear in the body of almost every posting
 * ("reports to the engineering manager") and would mislabel the level, which
 * then silently distorts every score.
 */
const LEVEL_PATTERNS = [
  [LEVEL.LEAD, ['lead', 'principal', 'staff engineer', 'architect', 'head of', 'director', 'vp']],
  [LEVEL.SENIOR, ['senior', 'sr', 'snr', 'iii', 'level 3', 'l3']],
  [LEVEL.JUNIOR, ['junior', 'jr', 'associate']],
  [LEVEL.ENTRY, ['entry level', 'entry-level', 'graduate', 'fresher', 'fresh graduate', 'intern']],
  [LEVEL.MID, ['mid-level', 'mid level', 'intermediate', 'level 2', 'l2']],
];

/** LinkedIn's "Seniority level" criteria values -> canonical level. */
export const LINKEDIN_SENIORITY_MAP = {
  internship: LEVEL.ENTRY,
  'entry level': LEVEL.ENTRY,
  associate: LEVEL.JUNIOR,
  'mid-senior level': LEVEL.SENIOR,
  director: LEVEL.LEAD,
  executive: LEVEL.LEAD,
  // "Not Applicable" intentionally unmapped -> stays null (unknown).
};

/* -------------------------------------------------------------------------- */
/*                                   SKILLS                                    */
/* -------------------------------------------------------------------------- */

/**
 * Canonical skill catalogue. `aliases` are matched case-insensitively against
 * job text with word boundaries, so "react" will not match "reactive".
 *
 * `group` is only used to organise the mobile Preferences UI.
 */
export const SKILLS = [
  // --- JavaScript / Web ---
  { id: 'react', label: 'React', group: 'Frontend', aliases: ['react', 'react.js', 'reactjs'] },
  {
    id: 'react_native',
    label: 'React Native',
    group: 'Mobile',
    aliases: ['react native', 'react-native', 'reactnative', 'rn developer'],
  },
  { id: 'nextjs', label: 'Next.js', group: 'Frontend', aliases: ['next.js', 'nextjs', 'next js'] },
  { id: 'vue', label: 'Vue', group: 'Frontend', aliases: ['vue', 'vue.js', 'vuejs', 'nuxt'] },
  { id: 'angular', label: 'Angular', group: 'Frontend', aliases: ['angular', 'angularjs'] },
  { id: 'svelte', label: 'Svelte', group: 'Frontend', aliases: ['svelte', 'sveltekit'] },
  {
    id: 'javascript',
    label: 'JavaScript',
    group: 'Languages',
    aliases: ['javascript', 'java script', 'es6', 'ecmascript'],
  },
  { id: 'typescript', label: 'TypeScript', group: 'Languages', aliases: ['typescript', 'ts'] },
  {
    id: 'nodejs',
    label: 'Node.js',
    group: 'Backend',
    aliases: ['node.js', 'nodejs', 'node js', 'node'],
  },
  { id: 'express', label: 'Express', group: 'Backend', aliases: ['express', 'express.js', 'expressjs'] },
  { id: 'nestjs', label: 'NestJS', group: 'Backend', aliases: ['nestjs', 'nest.js'] },
  {
    id: 'mern',
    label: 'MERN',
    group: 'Backend',
    aliases: ['mern', 'mern stack', 'mean stack'],
  },
  { id: 'redux', label: 'Redux', group: 'Frontend', aliases: ['redux', 'zustand', 'mobx', 'recoil'] },
  { id: 'graphql', label: 'GraphQL', group: 'Backend', aliases: ['graphql', 'apollo'] },
  { id: 'html_css', label: 'HTML/CSS', group: 'Frontend', aliases: ['html', 'css', 'scss', 'sass', 'tailwind'] },
  { id: 'threejs', label: 'Three.js', group: 'Frontend', aliases: ['three.js', 'threejs', 'webgl'] },

  // --- Other languages / backends ---
  { id: 'python', label: 'Python', group: 'Languages', aliases: ['python'] },
  { id: 'django', label: 'Django', group: 'Backend', aliases: ['django'] },
  { id: 'flask', label: 'Flask', group: 'Backend', aliases: ['flask', 'fastapi'] },
  { id: 'php', label: 'PHP', group: 'Languages', aliases: ['php'] },
  { id: 'laravel', label: 'Laravel', group: 'Backend', aliases: ['laravel'] },
  { id: 'java', label: 'Java', group: 'Languages', aliases: ['java'] },
  { id: 'spring_boot', label: 'Spring Boot', group: 'Backend', aliases: ['spring boot', 'springboot', 'spring'] },
  { id: 'dotnet', label: '.NET', group: 'Backend', aliases: ['.net', 'dotnet', 'asp.net', 'c#', 'csharp'] },
  { id: 'golang', label: 'Go', group: 'Languages', aliases: ['golang', 'go lang'] },
  { id: 'rust', label: 'Rust', group: 'Languages', aliases: ['rust'] },
  { id: 'ruby', label: 'Ruby', group: 'Languages', aliases: ['ruby', 'ruby on rails', 'rails'] },

  // --- Mobile ---
  { id: 'flutter', label: 'Flutter', group: 'Mobile', aliases: ['flutter', 'dart'] },
  { id: 'swift', label: 'Swift', group: 'Mobile', aliases: ['swift', 'swiftui', 'ios developer'] },
  { id: 'kotlin', label: 'Kotlin', group: 'Mobile', aliases: ['kotlin', 'jetpack compose'] },
  { id: 'android', label: 'Android', group: 'Mobile', aliases: ['android'] },

  // --- Data ---
  { id: 'mongodb', label: 'MongoDB', group: 'Database', aliases: ['mongodb', 'mongo', 'mongoose'] },
  { id: 'postgres', label: 'PostgreSQL', group: 'Database', aliases: ['postgresql', 'postgres'] },
  { id: 'mysql', label: 'MySQL', group: 'Database', aliases: ['mysql', 'mariadb'] },
  { id: 'redis', label: 'Redis', group: 'Database', aliases: ['redis'] },
  { id: 'sql', label: 'SQL', group: 'Database', aliases: ['sql server', 'mssql', 't-sql', 'plsql'] },
  { id: 'firebase', label: 'Firebase', group: 'Database', aliases: ['firebase', 'firestore', 'supabase'] },

  // --- Cloud / DevOps ---
  { id: 'aws', label: 'AWS', group: 'DevOps', aliases: ['aws', 'amazon web services', 'ec2', 'lambda', 's3'] },
  { id: 'azure', label: 'Azure', group: 'DevOps', aliases: ['azure'] },
  { id: 'gcp', label: 'GCP', group: 'DevOps', aliases: ['gcp', 'google cloud'] },
  { id: 'docker', label: 'Docker', group: 'DevOps', aliases: ['docker', 'containerization'] },
  { id: 'kubernetes', label: 'Kubernetes', group: 'DevOps', aliases: ['kubernetes', 'k8s'] },
  { id: 'devops', label: 'DevOps', group: 'DevOps', aliases: ['devops', 'ci/cd', 'terraform', 'jenkins', 'sre'] },

  // --- AI / ML ---
  { id: 'machine_learning', label: 'Machine Learning', group: 'AI', aliases: ['machine learning', 'ml engineer', 'deep learning'] },
  { id: 'ai_engineering', label: 'AI Engineering', group: 'AI', aliases: ['ai engineer', 'generative ai', 'gen ai', 'genai', 'llm', 'rag', 'langchain'] },
  { id: 'data_science', label: 'Data Science', group: 'AI', aliases: ['data science', 'data scientist', 'pandas', 'numpy'] },
  { id: 'computer_vision', label: 'Computer Vision', group: 'AI', aliases: ['computer vision', 'opencv', 'image processing'] },
];

export const SKILL_IDS = SKILLS.map((s) => s.id);

/** id -> skill definition (fast lookup). */
export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));

/** Skill groups in a stable display order, for the Preferences UI. */
export const SKILL_GROUPS = [...new Set(SKILLS.map((s) => s.group))];

/**
 * Pre-compiled alias matchers.
 *
 * WHY regex and not `includes()`: plain substring matching produces false
 * positives that quietly poison the score — "go" matches "Django", "react"
 * matches "reactive", "java" matches "javascript". Word boundaries fix that.
 * We build the regex once at module load, not per job.
 */
const SKILL_MATCHERS = SKILLS.map((skill) => ({
  id: skill.id,
  // Sort longest-first so "react native" wins over "react" when both appear.
  patterns: [...skill.aliases]
    .sort((a, b) => b.length - a.length)
    .map((alias) => new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(alias)}([^a-z0-9+#]|$)`, 'i')),
}));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* -------------------------------------------------------------------------- */
/*                                  COUNTRIES                                  */
/* -------------------------------------------------------------------------- */

/**
 * Countries the system understands. `geoId` is LinkedIn's identifier (needed to
 * drive the LinkedIn search); other sources only need `code` + `aliases`.
 * Adding a country here makes it available in the app automatically.
 */
export const COUNTRIES = [
  { id: 'PK', label: 'Pakistan', geoId: '101022442', aliases: ['pakistan', 'karachi', 'lahore', 'islamabad', 'rawalpindi', 'faisalabad', 'peshawar', 'multan', 'sialkot', 'quetta'] },
  { id: 'US', label: 'United States', geoId: '103644278', aliases: ['united states', 'usa', 'u.s.', 'america', 'new york', 'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'los angeles'] },
  { id: 'GB', label: 'United Kingdom', geoId: '101165590', aliases: ['united kingdom', 'uk', 'england', 'london', 'manchester', 'scotland', 'wales'] },
  { id: 'CA', label: 'Canada', geoId: '101174742', aliases: ['canada', 'toronto', 'vancouver', 'montreal', 'ottawa'] },
  { id: 'AE', label: 'United Arab Emirates', geoId: '104305776', aliases: ['united arab emirates', 'uae', 'dubai', 'abu dhabi', 'sharjah'] },
  { id: 'AU', label: 'Australia', geoId: '101452733', aliases: ['australia', 'sydney', 'melbourne', 'brisbane', 'perth'] },
  { id: 'DE', label: 'Germany', geoId: '101282230', aliases: ['germany', 'berlin', 'munich', 'hamburg', 'frankfurt'] },
  { id: 'IN', label: 'India', geoId: '102713980', aliases: ['india', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai', 'noida', 'gurgaon'] },
  { id: 'SA', label: 'Saudi Arabia', geoId: '100459316', aliases: ['saudi arabia', 'riyadh', 'jeddah', 'dammam'] },
  { id: 'NL', label: 'Netherlands', geoId: '102890719', aliases: ['netherlands', 'amsterdam', 'rotterdam', 'holland'] },
  { id: 'SG', label: 'Singapore', geoId: '102454443', aliases: ['singapore'] },
  { id: 'IE', label: 'Ireland', geoId: '104738515', aliases: ['ireland', 'dublin'] },
];

export const COUNTRY_BY_ID = new Map(COUNTRIES.map((c) => [c.id, c]));
export const COUNTRY_BY_GEO_ID = new Map(COUNTRIES.filter((c) => c.geoId).map((c) => [c.geoId, c]));

/** Special pseudo-country used by remote boards with no geography. */
export const COUNTRY_WORLDWIDE = 'WW';

const COUNTRY_MATCHERS = COUNTRIES.map((country) => ({
  id: country.id,
  patterns: [...country.aliases]
    .sort((a, b) => b.length - a.length)
    .map((alias) => new RegExp(`(^|[^a-z])${escapeRegex(alias)}([^a-z]|$)`, 'i')),
}));

/* -------------------------------------------------------------------------- */
/*                                  CURRENCIES                                 */
/* -------------------------------------------------------------------------- */

export const CURRENCIES = ['USD', 'PKR', 'GBP', 'EUR', 'AED', 'CAD', 'AUD', 'INR', 'SAR', 'SGD'];

/** Rough FX to USD — used ONLY to compare a salary against a user's minimum. */
export const FX_TO_USD = {
  USD: 1,
  PKR: 0.0036,
  GBP: 1.27,
  EUR: 1.08,
  AED: 0.27,
  CAD: 0.73,
  AUD: 0.66,
  INR: 0.012,
  SAR: 0.27,
  SGD: 0.74,
};

const CURRENCY_SYMBOLS = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '₨': 'PKR',
  rs: 'PKR',
  pkr: 'PKR',
  usd: 'USD',
  gbp: 'GBP',
  eur: 'EUR',
  aed: 'AED',
  cad: 'CAD',
  aud: 'AUD',
  inr: 'INR',
  '₹': 'INR',
  sar: 'SAR',
  sgd: 'SGD',
};

/* -------------------------------------------------------------------------- */
/*                              DETECTION HELPERS                              */
/* -------------------------------------------------------------------------- */

/**
 * Find every canonical skill mentioned in a block of text.
 * @param {string} text
 * @returns {string[]} canonical skill ids (unique, stable order)
 */
export function detectSkills(text) {
  if (!text) return [];
  const haystack = ` ${String(text).toLowerCase()} `;
  const found = [];
  for (const matcher of SKILL_MATCHERS) {
    if (matcher.patterns.some((re) => re.test(haystack))) found.push(matcher.id);
  }
  return found;
}

/**
 * Compile a [id, phrases[]] table into word-boundary regexes.
 *
 * WHY this is not `String.includes`: substring matching silently corrupts
 * every downstream score. Real cases caught in testing — "intern" matched
 * "internal"/"international" so an Assistant General Counsel role was labelled
 * an internship; "lead" matched "leading"/"leadership" so half the corpus
 * became lead-level. A mislabelled job is worse than an unlabelled one,
 * because "unknown" is scored neutrally while a wrong label is scored
 * confidently.
 */
function compilePhraseTable(table) {
  return table.map(([id, phrases]) => [
    id,
    phrases
      .slice()
      .sort((a, b) => b.length - a.length)
      .map((phrase) => new RegExp(`(^|[^a-z0-9])${escapeRegex(phrase)}([^a-z0-9]|$)`, 'i')),
  ]);
}

const WORKPLACE_MATCHERS = compilePhraseTable(WORKPLACE_PATTERNS);
const JOB_TYPE_MATCHERS = compilePhraseTable(JOB_TYPE_PATTERNS);
const LEVEL_MATCHERS = compilePhraseTable(LEVEL_PATTERNS);

function matchTable(matchers, text) {
  if (!text) return null;
  const haystack = ` ${String(text).toLowerCase()} `;
  for (const [id, patterns] of matchers) {
    if (patterns.some((re) => re.test(haystack))) return id;
  }
  return null;
}

/**
 * Detect the workplace mode from free text. Returns null when nothing matches,
 * which the scorer treats as "unknown" (neutral), never as a mismatch.
 * @returns {string|null}
 */
export function detectWorkplace(text) {
  return matchTable(WORKPLACE_MATCHERS, text);
}

/** @returns {string|null} canonical job type */
export function detectJobType(text) {
  return matchTable(JOB_TYPE_MATCHERS, text);
}

/**
 * @returns {string|null} canonical experience level
 *
 * Callers should pass the TITLE first. Seniority lives in titles; scanning a
 * whole description for it produces far more noise than signal.
 */
export function detectLevel(text) {
  return matchTable(LEVEL_MATCHERS, text);
}

/**
 * Detect the country from a location string (e.g. "Lahore, Punjab, Pakistan").
 * @returns {string|null} ISO-ish country id from COUNTRIES
 */
export function detectCountry(text) {
  if (!text) return null;
  const haystack = ` ${String(text).toLowerCase()} `;
  for (const matcher of COUNTRY_MATCHERS) {
    if (matcher.patterns.some((re) => re.test(haystack))) return matcher.id;
  }
  return null;
}

/**
 * Plausible salary ranges per period, used to reject false positives.
 * Values are in the ORIGINAL currency, so the bands are deliberately wide —
 * an annual PKR salary is legitimately in the millions.
 */
const SALARY_BOUNDS = {
  hour: [5, 5_000],
  month: [500, 5_000_000],
  year: [8_000, 500_000_000],
};

/**
 * Best-effort salary extraction from free text.
 *
 * DELIBERATELY CONSERVATIVE. A wrong salary is strictly worse than no salary:
 * "unknown" scores neutrally, but a bogus figure below the user's minimum
 * actively buries a good job. Testing found the naive version reading "$124"
 * out of a legal-department paragraph and filing it as a monthly wage, so
 * three guards now apply:
 *
 *   1. The number must LOOK like a salary — comma-grouped ("120,000"), a
 *      k/m suffix ("65k"), or at least 4 digits. "$124" fails all three.
 *   2. The figure must fall inside a plausible band for its period.
 *   3. The currency token must sit directly beside the number.
 *
 * @returns {{min:number|null,max:number|null,currency:string,period:string}|null}
 */
export function detectSalary(text) {
  if (!text) return null;
  const raw = String(text);

  // "$120,000 - $150,000" | "PKR 150k-250k" | "£65k" | "USD 150,000 to 200,000"
  const re =
    /(\$|£|€|₹|₨|usd|pkr|gbp|eur|aed|cad|aud|inr|sar|sgd|rs\.?)\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m)?\s*(?:-|–|—|to|until)?\s*(?:(?:\$|£|€|₹|₨)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m)?)?/i;
  const match = raw.match(re);
  if (!match) return null;

  const [, symbol, rawMin, minSuffix, rawMax, maxSuffix] = match;

  // Guard 1: does this even look like money rather than a stray number?
  if (!looksMonetary(rawMin, minSuffix)) return null;

  const currency = CURRENCY_SYMBOLS[symbol.toLowerCase().replace('.', '')] || 'USD';
  const min = parseAmount(rawMin, minSuffix);
  const max = looksMonetary(rawMax, maxSuffix) ? parseAmount(rawMax, maxSuffix) : null;
  if (min == null && max == null) return null;

  const period = /per hour|\/\s?hr|hourly|an hour/i.test(raw)
    ? 'hour'
    : /per month|\/\s?mo\b|monthly|a month/i.test(raw)
      ? 'month'
      : 'year';

  // Guard 2: plausible for that period?
  const [low, high] = SALARY_BOUNDS[period];
  const probe = min ?? max;
  if (probe < low || probe > high) return null;

  return { min, max: max ?? null, currency, period };
}

/** Comma-grouped, k/m-suffixed, or 4+ digits — otherwise it is not a salary. */
function looksMonetary(digits, suffix) {
  if (!digits) return false;
  if (suffix) return true;
  if (digits.includes(',')) return true;
  return digits.replace(/[^\d]/g, '').length >= 4;
}

function parseAmount(digits, suffix) {
  if (!digits) return null;
  let value = parseFloat(digits.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  if (suffix?.toLowerCase() === 'k') value *= 1_000;
  if (suffix?.toLowerCase() === 'm') value *= 1_000_000;
  return Math.round(value);
}

/**
 * Convert any salary to a comparable annual USD figure so the scorer can
 * compare a PKR/month offer against a USD/year expectation.
 * @returns {number|null}
 */
export function toAnnualUsd(salary) {
  if (!salary) return null;
  const amount = salary.max ?? salary.min;
  if (amount == null) return null;
  const fx = FX_TO_USD[salary.currency] ?? 1;
  const multiplier = salary.period === 'hour' ? 2080 : salary.period === 'month' ? 12 : 1;
  return Math.round(amount * fx * multiplier);
}

/* -------------------------------------------------------------------------- */
/*                                  VALIDATION                                 */
/* -------------------------------------------------------------------------- */

const VALID = {
  workplace: new Set(Object.values(WORKPLACE)),
  jobType: new Set(Object.values(JOB_TYPE)),
  level: new Set(Object.values(LEVEL)),
  skill: new Set(SKILL_IDS),
  country: new Set([...COUNTRIES.map((c) => c.id), COUNTRY_WORLDWIDE]),
};

/** Drop anything that is not a known canonical id (defensive: client input). */
export function sanitizeIds(values, kind) {
  const allowed = VALID[kind];
  if (!allowed || !Array.isArray(values)) return [];
  return [...new Set(values.filter((v) => typeof v === 'string' && allowed.has(v)))];
}

export function isValidId(value, kind) {
  return Boolean(VALID[kind]?.has(value));
}
