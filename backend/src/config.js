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
  const filePath = optionalEnv('FIREBASE_SERVICE_ACCOUNT_PATH');

  if (filePath) {
    const absolutePath = resolve(process.cwd(), filePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Service account file not found: ${absolutePath}`);
    }
    const raw = readFileSync(absolutePath, 'utf8');
    return JSON.parse(raw);
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
    upworkRssUrl: requireEnv('UPWORK_RSS_URL'),
    linkedinSearchUrl: requireEnv('LINKEDIN_SEARCH_URL'),
    linkedinLiAt: requireEnv('LINKEDIN_LI_AT'),
    keywordFilter: optionalEnv('KEYWORD_FILTER', '').toLowerCase(),
    maxJobsPerRun: parseInt(optionalEnv('MAX_JOBS_PER_RUN', '50'), 10),
  };
}
