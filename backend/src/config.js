import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Load backend/.env automatically for local runs
dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        'Create backend/.env from .env.example — see backend/SETUP.md'
    );
  }
  return value.trim();
}

function optionalEnv(name, fallback = '') {
  const value = process.env[name];
  return value?.trim() || fallback;
}

function loadServiceAccount() {
  // Prefer a local file if it actually exists (local dev). On CI the file is
  // not committed (a Firebase key in a public repo gets auto-revoked by Google),
  // so fall back to the FIREBASE_SERVICE_ACCOUNT env / GitHub Secret.
  const filePath = optionalEnv('FIREBASE_SERVICE_ACCOUNT_PATH');

  if (filePath) {
    const absolutePath = resolve(process.cwd(), filePath);
    if (existsSync(absolutePath)) {
      const raw = readFileSync(absolutePath, 'utf8');
      return JSON.parse(raw);
    }
    // file missing -> fall through to the env-based credential
  }

  const raw = requireEnv('FIREBASE_SERVICE_ACCOUNT');
  return JSON.parse(raw);
}

export function loadConfig() {
  let firebaseServiceAccount;

  try {
    firebaseServiceAccount = loadServiceAccount();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT must be valid JSON, or set FIREBASE_SERVICE_ACCOUNT_PATH to a .json file'
      );
    }
    throw error;
  }

  if (!firebaseServiceAccount?.project_id) {
    throw new Error('Invalid Firebase service account: missing project_id');
  }

  return {
    firebaseServiceAccount,
    // Upwork is parked (its feed is dead / Cloudflare-blocked). Set
    // UPWORK_ENABLED=true once a working source (API) is wired up.
    upworkEnabled: optionalEnv('UPWORK_ENABLED', 'false').toLowerCase() === 'true',
    upworkRssUrl: optionalEnv('UPWORK_RSS_URL', ''),
    linkedinSearchUrl: requireEnv('LINKEDIN_SEARCH_URL'),
    // Comma-separated LinkedIn geoIds to restrict by country (each searched
    // separately and merged). Empty = worldwide.
    linkedinGeoIds: optionalEnv('LINKEDIN_GEO_IDS', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Boolean keyword query (AND/OR/NOT). Case handled by the filter itself.
    keywordFilter: optionalEnv('KEYWORD_FILTER', ''),
    maxJobsPerRun: parseInt(optionalEnv('MAX_JOBS_PER_RUN', '50'), 10),
  };
}
