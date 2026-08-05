/**
 * Environment configuration.
 *
 * WHAT CHANGED vs the previous version: the giant hard-coded LinkedIn search
 * URL and boolean KEYWORD_FILTER are gone. Those encoded ONE person's job
 * preferences into the ingestion layer, which is exactly what made the feed
 * global instead of personal. Relevance is now decided per user by the
 * recommendation engine (src/reco/), and ingestion casts a deliberately wide
 * net so the shared job pool serves everybody.
 *
 * The Firebase credential handling is unchanged — it is the one thing here
 * that has already been debugged the hard way (a key committed to a public
 * repo gets auto-revoked by Google), so it stays exactly as it was.
 */

import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

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
  // Prefer a local file when it exists (dev). On CI/Vercel the file is not
  // committed — a Firebase key in a public repo gets auto-revoked by Google —
  // so fall back to the FIREBASE_SERVICE_ACCOUNT env var / GitHub Secret.
  const filePath = optionalEnv('FIREBASE_SERVICE_ACCOUNT_PATH');

  if (filePath) {
    const absolutePath = resolve(process.cwd(), filePath);
    if (existsSync(absolutePath)) {
      return JSON.parse(readFileSync(absolutePath, 'utf8'));
    }
  }

  return JSON.parse(requireEnv('FIREBASE_SERVICE_ACCOUNT'));
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
    /** Shared secret guarding the write endpoints. */
    runSecret: optionalEnv('RUN_SECRET', ''),
    /** Comma-separated source ids to switch off without a redeploy. */
    disabledSources: optionalEnv('DISABLED_SOURCES', ''),
  };
}
