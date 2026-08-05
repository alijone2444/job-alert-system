import firestore from '@react-native-firebase/firestore';
import messaging from '@react-native-firebase/messaging';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import { api } from '../api/client';
import { logger } from '../utils/logger';

const USERS_COLLECTION = 'users';

/**
 * Stable per-installation identifier.
 *
 * This is NO LONGER the user id — that is now the Firebase uid. It survives
 * only to (a) identify this handset's push token and (b) find pre-auth data to
 * migrate into the account on first sign-in.
 */
export async function getDeviceId(): Promise<string> {
  const uniqueId = await DeviceInfo.getUniqueId();
  return `${Platform.OS}_${uniqueId}`;
}

/**
 * Register the signed-in account and this device's FCM token.
 *
 * Goes through the API first, because registration also seeds `prefsVersion` so
 * the next cron run builds an initial feed. If the API is unreachable we still
 * write the token straight to Firestore — losing push because a serverless
 * function was cold is not acceptable.
 */
export async function registerDevice(userId: string, fcmToken: string | null): Promise<void> {
  const deviceId = await getDeviceId();

  try {
    await api.register({
      userId,
      ...(fcmToken ? { fcmToken } : {}),
      platform: Platform.OS,
      appVersion: DeviceInfo.getVersion(),
    });
    logger.success('Device', 'Registered with backend');
    return;
  } catch (error) {
    logger.warn('Device', 'Backend registration failed, writing directly to Firestore', error);
  }

  await firestore()
    .collection(USERS_COLLECTION)
    .doc(userId)
    .set(
      {
        ...(fcmToken ? { fcmToken } : {}),
        platform: Platform.OS,
        deviceId,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  logger.success('Device', `Token saved to users/${userId}`);
}

/**
 * Move any pre-auth, device-keyed profile into the signed-in account.
 *
 * Fire-and-forget by design: a failed migration must never block someone from
 * using the app, and the call is idempotent, so the next launch retries.
 */
export async function claimDeviceData(deviceId: string): Promise<void> {
  try {
    const result = await api.claimDeviceData(deviceId);
    if (result.migrated) {
      logger.success('Device', `Migrated device data into account`, result.moved);
    }
  } catch (error) {
    logger.warn('Device', `Could not claim device data: ${(error as Error).message}`);
  }
}

/** Keep the stored token in sync when FCM rotates it. */
export function subscribeToTokenRefresh(
  userId: string,
  onRefresh: (token: string) => void
): () => void {
  return messaging().onTokenRefresh(async (newToken: string) => {
    logger.warn('FCM', 'Token refreshed — updating backend...');
    try {
      await registerDevice(userId, newToken);
      onRefresh(newToken);
    } catch (error) {
      logger.error('Device', 'Failed to update refreshed token', error);
    }
  });
}
