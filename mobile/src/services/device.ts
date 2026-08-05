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
 * This doubles as the `userId` throughout the system — there is no account or
 * login yet, so "the user" IS the device. Every API takes it as an opaque
 * string, so introducing Firebase Auth later means swapping what this function
 * returns and nothing else. See ARCHITECTURE.md.
 */
export async function getDeviceId(): Promise<string> {
  const uniqueId = await DeviceInfo.getUniqueId();
  const deviceId = `${Platform.OS}_${uniqueId}`;
  logger.info('Device', `Device ID: ${deviceId}`);
  return deviceId;
}

/**
 * Register this device and its FCM token.
 *
 * Goes through the API first, because registration also seeds `prefsVersion`
 * so the next cron run builds this user an initial feed. If the API is
 * unreachable we still write the token straight to Firestore — losing push
 * because a serverless function was cold is not acceptable.
 */
export async function registerDevice(deviceId: string, fcmToken: string | null): Promise<void> {
  try {
    await api.register({
      userId: deviceId,
      ...(fcmToken ? { fcmToken } : {}),
      platform: Platform.OS,
      appVersion: DeviceInfo.getVersion(),
    });
    logger.success('Device', 'Registered with backend');
    return;
  } catch (error) {
    logger.warn('Device', `Backend registration failed, writing directly to Firestore`, error);
  }

  await writeTokenToFirestore(deviceId, fcmToken);
}

async function writeTokenToFirestore(deviceId: string, fcmToken: string | null): Promise<void> {
  await firestore()
    .collection(USERS_COLLECTION)
    .doc(deviceId)
    .set(
      {
        ...(fcmToken ? { fcmToken } : {}),
        platform: Platform.OS,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  logger.success('Device', `Token saved to users/${deviceId}`);
}

/** Keep the stored token in sync when FCM rotates it. */
export function subscribeToTokenRefresh(
  deviceId: string,
  onRefresh: (token: string) => void
): () => void {
  logger.info('FCM', 'Listening for token refresh events...');

  return messaging().onTokenRefresh(async (newToken: string) => {
    logger.warn('FCM', 'Token refreshed — updating backend...');
    try {
      await registerDevice(deviceId, newToken);
      onRefresh(newToken);
    } catch (error) {
      logger.error('Device', 'Failed to update refreshed token', error);
    }
  });
}
