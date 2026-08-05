/**
 * Deploy Firestore security rules + composite indexes.
 *
 * WHY this script exists instead of `firebase deploy`: the firebase-tools CLI
 * is not installed here and pulling it in as a dependency for two REST calls is
 * not worth it. The same service account the backend already uses can talk to
 * the Firebase Rules and Firestore Admin APIs directly.
 *
 *   node scripts/deploy-firebase.mjs            # rules + indexes
 *   node scripts/deploy-firebase.mjs --rules    # rules only
 *   node scripts/deploy-firebase.mjs --indexes  # indexes only
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const RULES_PATH = resolve(repoRoot, 'firebase/firestore.rules');
const INDEXES_PATH = resolve(repoRoot, 'firebase/firestore.indexes.json');

function loadServiceAccount() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path) {
    const absolute = resolve(process.cwd(), path);
    try {
      return JSON.parse(readFileSync(absolute, 'utf8'));
    } catch {
      /* fall through to the env var */
    }
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT');
  }
  return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
}

const serviceAccount = loadServiceAccount();
const projectId = serviceAccount.project_id;

const credential = admin.credential.cert(serviceAccount);
const { access_token: accessToken } = await credential.getAccessToken();

async function callApi(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

/* ---------------------------------- rules --------------------------------- */

async function deployRules() {
  const source = readFileSync(RULES_PATH, 'utf8');

  // A ruleset is immutable; publishing means creating one and pointing the
  // `cloud.firestore` release at it.
  const ruleset = await callApi(`https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`, {
    method: 'POST',
    body: { source: { files: [{ name: 'firestore.rules', content: source }] } },
  });

  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  const body = { name: releaseName, rulesetName: ruleset.name };

  try {
    await callApi(`https://firebaserules.googleapis.com/v1/${releaseName}`, {
      method: 'PATCH',
      body: { release: body },
    });
  } catch (error) {
    // First-ever publish has no release to patch.
    if (error.status !== 404) throw error;
    await callApi(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`, {
      method: 'POST',
      body,
    });
  }

  console.log(`✅ Rules published — ${ruleset.name}`);
}

/* --------------------------------- indexes -------------------------------- */

async function deployIndexes() {
  const config = JSON.parse(readFileSync(INDEXES_PATH, 'utf8'));
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups`;

  let created = 0;
  let existing = 0;

  for (const index of config.indexes || []) {
    // Single-field indexes are automatic in Firestore; the API rejects them.
    if ((index.fields || []).length < 2) continue;

    const body = {
      queryScope: index.queryScope || 'COLLECTION',
      fields: index.fields.map((field) => ({
        fieldPath: field.fieldPath,
        ...(field.order ? { order: field.order } : {}),
        ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}),
      })),
    };

    try {
      await callApi(`${base}/${index.collectionGroup}/indexes`, { method: 'POST', body });
      created++;
      console.log(`   + ${index.collectionGroup}: ${index.fields.map((f) => f.fieldPath).join(', ')}`);
    } catch (error) {
      // 409 = already exists. Idempotent re-runs are the whole point.
      if (error.status === 409 || /already exists/i.test(error.message)) {
        existing++;
        continue;
      }
      console.error(`   ! ${index.collectionGroup}: ${error.message}`);
    }
  }

  console.log(`✅ Indexes — ${created} created, ${existing} already present`);
  if (created) console.log('   (Firestore builds indexes in the background; give it a minute.)');
}

/* ---------------------------------- main ---------------------------------- */

const args = process.argv.slice(2);
const runRules = args.length === 0 || args.includes('--rules');
const runIndexes = args.length === 0 || args.includes('--indexes');

console.log(`Deploying Firebase config for project: ${projectId}`);
if (runRules) await deployRules();
if (runIndexes) await deployIndexes();
