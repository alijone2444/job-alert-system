/**
 * List / add Android signing-certificate fingerprints on the Firebase app.
 *
 * Google Sign-In will not work unless the SHA-1 (and, for newer flows, SHA-256)
 * of the certificate that signed the APK is registered on the Firebase Android
 * app. Doing it here means one fewer manual console step to get wrong.
 *
 *   node scripts/firebase-sha.mjs                       # list what is registered
 *   node scripts/firebase-sha.mjs --add <SHA> [<SHA>…]  # register fingerprints
 *
 * NOTE: this cannot enable the Google sign-in PROVIDER — that creates an OAuth
 * client, which is console-only. See the setup notes in ARCHITECTURE.md.
 */

import admin from 'firebase-admin';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const projectId = config.firebaseServiceAccount.project_id;
const packageName = process.env.ANDROID_PACKAGE || 'com.jobalert';

const credential = admin.credential.cert(config.firebaseServiceAccount);
const { access_token: accessToken } = await credential.getAccessToken();

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://firebase.googleapis.com/v1beta1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

/** Find the Android app by package name. */
const { apps = [] } = await api(`projects/${projectId}/androidApps`);
const app = apps.find((entry) => entry.packageName === packageName);
if (!app) {
  console.error(`No Android app with package ${packageName} in project ${projectId}`);
  process.exit(1);
}
console.log(`App: ${app.appId} (${packageName})`);

const toAdd = process.argv.includes('--add')
  ? process.argv.slice(process.argv.indexOf('--add') + 1)
  : [];

/* --------------------------------- list ---------------------------------- */

async function listShas() {
  const { certificates = [] } = await api(`${app.name}/sha`);
  return certificates;
}

let certificates = await listShas();
console.log(`Registered fingerprints: ${certificates.length}`);
for (const cert of certificates) {
  console.log(`  ${cert.certType.padEnd(8)} ${cert.shaHash}`);
}

if (!toAdd.length) {
  console.log('\nPass --add <SHA1/SHA256>… to register more.');
  process.exit(0);
}

/* ---------------------------------- add ----------------------------------- */

const existing = new Set(certificates.map((cert) => cert.shaHash.toLowerCase().replace(/:/g, '')));

for (const raw of toAdd) {
  const normalized = raw.trim().toLowerCase().replace(/:/g, '');
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(normalized)) {
    console.error(`  ! skipping "${raw}" — not a SHA-1 (40 hex) or SHA-256 (64 hex)`);
    continue;
  }
  if (existing.has(normalized)) {
    console.log(`  = already registered: ${raw}`);
    continue;
  }

  const certType = normalized.length === 40 ? 'SHA_1' : 'SHA_256';
  try {
    await api(`${app.name}/sha`, { method: 'POST', body: { shaHash: normalized, certType } });
    console.log(`  + added ${certType}: ${raw}`);
  } catch (error) {
    console.error(`  ! failed to add ${raw}: ${error.message}`);
  }
}

certificates = await listShas();
console.log(`\nNow registered: ${certificates.length}`);
console.log('Download a fresh google-services.json after enabling the Google provider.');
