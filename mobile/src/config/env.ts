/**
 * Build-time configuration.
 *
 * Kept as a plain module rather than react-native-config so there is no extra
 * native dependency to break a release build. Change the values here and
 * rebuild; the API key must match APP_API_KEY (or RUN_SECRET) on Vercel.
 */

export const API_BASE_URL = 'https://job-alert-system-two.vercel.app';

/**
 * Sent as `X-App-Key`. Empty string = the backend has no APP_API_KEY set and
 * is running unauthenticated (fine for local development).
 *
 * NOTE: this is a shared app key, not a user credential — it stops casual
 * abuse of the public endpoints, nothing more. Real per-user auth arrives with
 * Firebase Auth; see ARCHITECTURE.md.
 */
export const APP_API_KEY = 'pk-jobs-9f3a';

/** Requests are aborted after this. Mobile networks stall rather than fail. */
export const API_TIMEOUT_MS = 15000;

/** How many feed cards the live Firestore listener keeps in memory. */
export const FEED_PAGE_SIZE = 100;
