/**
 * Google Sign-In + Firebase Auth.
 *
 * WHY this replaces the device id: a device id is not an identity. Reinstall
 * the app and every preference and saved job is gone; change phone and you
 * start over; and anyone who learns your device id can read your feed. A
 * Firebase uid is stable across installs and devices, and the backend can
 * actually verify it.
 *
 * The uid becomes the `userId` used everywhere in the system. Nothing else in
 * the architecture changes — every API already took `userId` as an opaque
 * string precisely so this swap would be local.
 *
 * SETUP (Firebase console, one time):
 *   1. Authentication -> Sign-in method -> Google -> Enable -> set support email
 *   2. Project settings -> Android app -> SHA-1 + SHA-256 registered
 *      (`backend/npm run firebase:sha` does this)
 *   3. Download the updated google-services.json into mobile/android/app/
 * The web client id is then read straight out of google-services.json — see
 * config/googleServices.ts — so there is no id to copy by hand.
 */

import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from '@react-native-google-signin/google-signin';
import { WEB_CLIENT_ID } from '../config/googleServices';
import { logger } from '../utils/logger';

export type AuthUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
};

export class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

let configured = false;

/** Idempotent — safe to call on every launch. */
export function configureGoogleSignIn(): void {
  if (configured) return;

  if (!WEB_CLIENT_ID) {
    logger.warn('Auth', 'No web client id — enable Google sign-in in Firebase and re-download google-services.json');
    return;
  }

  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    offlineAccess: false,
  });
  configured = true;
  logger.info('Auth', 'Google Sign-In configured');
}

export function isGoogleSignInAvailable(): boolean {
  return Boolean(WEB_CLIENT_ID);
}

function toAuthUser(user: FirebaseAuthTypes.User | null): AuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

/** Fires immediately with the current user, then on every auth change. */
export function subscribeToAuth(onChange: (user: AuthUser | null) => void): () => void {
  return auth().onAuthStateChanged((user) => {
    logger.info('Auth', user ? `Signed in as ${user.email ?? user.uid}` : 'Signed out');
    onChange(toAuthUser(user));
  });
}

export function getCurrentUser(): AuthUser | null {
  return toAuthUser(auth().currentUser);
}

/**
 * The bearer token the backend verifies.
 *
 * `getIdToken()` refreshes automatically when the cached token is close to
 * expiry, so callers can just ask for it before every request rather than
 * trying to manage a refresh schedule themselves.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth().currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch (error) {
    logger.warn('Auth', `Could not get ID token: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Full Google sign-in flow.
 * @throws {AuthError} with a code the UI can branch on
 */
export async function signInWithGoogle(): Promise<AuthUser> {
  configureGoogleSignIn();

  if (!WEB_CLIENT_ID) {
    throw new AuthError(
      'not_configured',
      'Google sign-in is not set up for this build yet. Enable it in Firebase and rebuild.'
    );
  }

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();

    // v13+ returns {type:'success'|'cancelled', data}; older returns the user.
    const idToken =
      (response as any)?.data?.idToken ?? (response as any)?.idToken ?? null;

    if ((response as any)?.type === 'cancelled') {
      throw new AuthError('cancelled', 'Sign-in cancelled');
    }
    if (!idToken) {
      throw new AuthError('no_token', 'Google did not return an ID token');
    }

    const credential = auth.GoogleAuthProvider.credential(idToken);
    const result = await auth().signInWithCredential(credential);

    logger.success('Auth', `Signed in: ${result.user.email ?? result.user.uid}`);
    return toAuthUser(result.user)!;
  } catch (error) {
    if (error instanceof AuthError) throw error;

    if (isErrorWithCode(error)) {
      switch (error.code) {
        case statusCodes.SIGN_IN_CANCELLED:
          throw new AuthError('cancelled', 'Sign-in cancelled');
        case statusCodes.IN_PROGRESS:
          throw new AuthError('in_progress', 'Sign-in already in progress');
        case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
          throw new AuthError(
            'no_play_services',
            'Google Play Services is required to sign in'
          );
        default:
          break;
      }
    }

    const message = (error as Error)?.message || 'Sign-in failed';
    logger.error('Auth', 'Sign-in failed', message);

    // DEVELOPER_ERROR nearly always means the signing certificate's SHA-1 is
    // not registered on the Firebase app — worth saying so rather than
    // surfacing an opaque platform error.
    if (/DEVELOPER_ERROR|10:/.test(message)) {
      throw new AuthError(
        'developer_error',
        "Sign-in rejected. This build's signing certificate is not registered in Firebase (SHA-1/SHA-256)."
      );
    }
    throw new AuthError('unknown', message);
  }
}

export async function signOut(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // Already signed out of Google, or never configured — not fatal.
  }
  await auth().signOut();
  logger.info('Auth', 'Signed out');
}
