/**
 * Values read out of `android/app/google-services.json`.
 *
 * WHY import the JSON instead of pasting the id into a constant: the web client
 * id is regenerated whenever Google Sign-In is (re)configured in the Firebase
 * console. Hard-coding it guarantees that one day it is silently stale and
 * sign-in fails with an opaque DEVELOPER_ERROR. Reading it from the same file
 * the native SDK reads means the two can never disagree.
 *
 * If Google Sign-In has not been enabled in the console yet, the file has no
 * `oauth_client` entries and this resolves to '' — the app then shows a clear
 * "not set up yet" message instead of crashing.
 */

import googleServices from '../../android/app/google-services.json';

type OAuthClient = { client_id: string; client_type: number };

/** client_type 3 is the WEB client — the one Firebase Auth needs. */
const WEB_CLIENT_TYPE = 3;

function findWebClientId(): string {
  try {
    for (const client of (googleServices as any).client ?? []) {
      for (const oauth of (client.oauth_client ?? []) as OAuthClient[]) {
        if (oauth.client_type === WEB_CLIENT_TYPE && oauth.client_id) {
          return oauth.client_id;
        }
      }
    }
  } catch {
    /* fall through */
  }
  return '';
}

export const WEB_CLIENT_ID = findWebClientId();

export const FIREBASE_PROJECT_ID: string =
  (googleServices as any)?.project_info?.project_id ?? '';
