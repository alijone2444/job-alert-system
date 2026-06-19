import firestore from '@react-native-firebase/firestore';
import messaging from '@react-native-firebase/messaging';
import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import { logger } from '../utils/logger';

const USERS_COLLECTION = 'users';

/**
 * Returns a stable per-installation device identifier.
 */
export async function getDeviceId(): Promise<string> {
  const uniqueId = await DeviceInfo.getUniqueId();
  const deviceId = `${Platform.OS}_${uniqueId}`;
  logger.info('Device', `Device ID: ${deviceId}`);
  return deviceId;
}

/**
 * Save or update the device's FCM token in Firestore.
 */
export async function saveFcmToken(deviceId: string, fcmToken: string): Promise<void> {
  logger.info('Firestore', `Saving FCM token for device: ${deviceId}`);

  await firestore()
    .collection(USERS_COLLECTION)
    .doc(deviceId)
    .set(
      {
        fcmToken,
        platform: Platform.OS,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  logger.success('Firestore', `Token saved to users/${deviceId}`);
}

/**
 * Subscribe to token refresh events and keep Firestore in sync.
 */
export function subscribeToTokenRefresh(
  deviceId: string,
  onRefresh: (token: string) => void
): () => void {
  logger.info('FCM', 'Listening for token refresh events...');

  return messaging().onTokenRefresh(async (newToken: string) => {
    logger.warn('FCM', 'Token refreshed — updating Firestore...');
    try {
      await saveFcmToken(deviceId, newToken);
      onRefresh(newToken);
      logger.success('FCM', 'Refreshed token saved successfully');
    } catch (error) {
      logger.error('Firestore', 'Failed to update refreshed token', error);
    }
  });
}
