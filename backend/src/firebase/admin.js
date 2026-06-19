import admin from 'firebase-admin';

let initialized = false;

/**
 * Initialize Firebase Admin SDK from service account credentials.
 * @param {object} serviceAccount
 * @returns {import('firebase-admin').app.App}
 */
export function initFirebase(serviceAccount) {
  if (initialized) {
    return admin.app();
  }

  if (!serviceAccount?.project_id) {
    throw new Error('Invalid Firebase service account: missing project_id');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  initialized = true;
  console.log(`[Firebase] Admin SDK initialized for project: ${serviceAccount.project_id}`);
  return admin.app();
}

export function getFirestore() {
  if (!initialized) {
    throw new Error('Firebase Admin not initialized. Call initFirebase() first.');
  }
  return admin.firestore();
}

export function getMessaging() {
  if (!initialized) {
    throw new Error('Firebase Admin not initialized. Call initFirebase() first.');
  }
  return admin.messaging();
}
