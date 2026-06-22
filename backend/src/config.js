import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Load backend/.env automatically for local runs
dotenv.config();

// Default job-title relevance filter (used when KEYWORD_FILTER env is not set).
// Tuned for a MERN / React Native / Node / .NET / AI engineer: requires a
// RELEVANT stack/role term (not the bare word "developer", so "WordPress
// Developer" / "Game Developer" drop), and excludes clear noise. Edit + push to
// update everywhere (local, GitHub Actions, Vercel).
const DEFAULT_KEYWORD_FILTER =
  '("react native" OR "react.js" OR reactjs OR react OR mern OR "node.js" OR nodejs OR node OR express OR mongodb OR "next.js" OR nextjs OR redux OR zustand OR typescript OR javascript OR "full stack" OR "full-stack" OR fullstack OR "front end" OR "front-end" OR frontend OR "back end" OR backend OR "web developer" OR "software engineer" OR "software developer" OR ".net" OR dotnet OR "asp.net" OR "c#" OR "three.js" OR threejs OR webgl OR "ai engineer" OR "ml engineer" OR "machine learning" OR "artificial intelligence" OR "ai developer" OR "generative ai" OR "gen ai" OR genai OR llm OR "computer vision" OR "deep learning" OR "data scientist" OR mlops OR aws OR mobile OR sde) ' +
  'NOT (wordpress OR php OR laravel OR drupal OR magento OR shopify OR wix OR webflow OR game OR gaming OR unity OR unreal OR godot OR roblox OR salesforce OR servicenow OR sap OR sharepoint OR "power bi" OR tableau OR odoo OR "business analyst" OR "data entry" OR qa OR sdet OR "quality assurance" OR tester OR mechanical OR civil OR electrical OR electronics OR hardware OR embedded OR firmware OR "network engineer" OR sysadmin OR sales OR marketing OR seo OR recruiter OR "project manager" OR "scrum master" OR director OR "vice president" OR "head of" OR cto OR "engineering manager" OR "user acquisition" OR aso OR sound OR video OR instructor OR intern OR internship OR "senior ai" OR "lead ai" OR "principal ai" OR "staff ai" OR "ai architect" OR "head of ai" OR phd OR "research scientist" OR "applied scientist" OR "machine learning scientist" OR "ai trainer" OR "ai training")';

// Default LinkedIn search — dev-primary (MERN/React Native/Node/.NET/web) with
// AI kept SECONDARY (only "ai engineer" in the search so AI doesn't flood). No
// Flutter. f_E=1,2,3,4 = internship..mid-senior (excludes Director/Exec).
const DEFAULT_LINKEDIN_SEARCH_URL =
  'https://www.linkedin.com/jobs/search/?keywords=' +
  '(%22react%20native%22%20OR%20%22react.js%22%20OR%20reactjs%20OR%20mern%20OR%20%22node.js%22%20OR%20nodejs%20OR%20%22next.js%22%20OR%20express%20OR%20mongodb%20OR%20redux%20OR%20%22full%20stack%22%20OR%20%22.net%22%20OR%20%22asp.net%22%20OR%20%22c%23%22%20OR%20javascript%20OR%20typescript%20OR%20%22software%20engineer%22%20OR%20%22web%20developer%22%20OR%20%22three.js%22%20OR%20%22ai%20engineer%22)' +
  '&f_E=1,2,3,4&f_TPR=r86400&sortBy=DD';

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
    linkedinSearchUrl: optionalEnv('LINKEDIN_SEARCH_URL', '') || DEFAULT_LINKEDIN_SEARCH_URL,
    // Comma-separated LinkedIn geoIds to restrict by country (each searched
    // separately and merged). Empty = worldwide.
    linkedinGeoIds: optionalEnv('LINKEDIN_GEO_IDS', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Boolean keyword query (AND/OR/NOT). Falls back to the tuned default above.
    keywordFilter: optionalEnv('KEYWORD_FILTER', '') || DEFAULT_KEYWORD_FILTER,
    maxJobsPerRun: parseInt(optionalEnv('MAX_JOBS_PER_RUN', '50'), 10),
  };
}
