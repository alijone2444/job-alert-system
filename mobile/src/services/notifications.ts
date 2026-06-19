import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';
import { getDeviceId, saveFcmToken, subscribeToTokenRefresh } from './device';
import { logger } from '../utils/logger';

export type NotificationSetupResult = {
  deviceId: string;
  fcmToken: string | null;
  permissionGranted: boolean;
};

/**
 * Request notification permissions (iOS + Android 13+).
 */
export async function requestNotificationPermission(): Promise<boolean> {
  logger.info('FCM', 'Requesting notification permission...');

  if (Platform.OS === 'android' && Platform.Version >= 33) {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    logger.info('FCM', `Android POST_NOTIFICATIONS result: ${result}`);
    if (result !== PermissionsAndroid.RESULTS.GRANTED) {
      logger.warn('FCM', 'Android notification permission denied');
      return false;
    }
  }

  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

  logger.info('FCM', `Permission result: ${enabled ? 'GRANTED' : 'DENIED'} (status: ${authStatus})`);
  return enabled;
}

/**
 * Full startup flow: permissions → FCM token → Firestore registration.
 */
export async function setupPushNotifications(): Promise<NotificationSetupResult> {
  logger.divider('PushSetup');
  logger.info('PushSetup', 'Starting push notification setup...');

  const permissionGranted = await requestNotificationPermission();

  if (!permissionGranted) {
    const deviceId = await getDeviceId();
    logger.warn('PushSetup', 'Setup incomplete — permission denied');
    return { deviceId, fcmToken: null, permissionGranted: false };
  }

  const deviceId = await getDeviceId();
  let fcmToken: string | null = null;

  try {
    fcmToken = await messaging().getToken();
    if (fcmToken) {
      logger.success('FCM', `Token received: ${fcmToken.slice(0, 24)}...`);
      await saveFcmToken(deviceId, fcmToken);
      logger.success('PushSetup', 'Push notifications fully configured!');
    } else {
      logger.warn('FCM', 'getToken() returned empty token');
    }
  } catch (error) {
    logger.error('FCM', 'Failed to retrieve or save token', error);
  }

  logger.divider('PushSetup');
  return { deviceId, fcmToken, permissionGranted };
}

/**
 * Listen for foreground push messages.
 */
export function onForegroundMessage(
  handler: (message: FirebaseMessagingTypes.RemoteMessage) => void
): () => void {
  logger.info('FCM', 'Foreground message listener registered');
  return messaging().onMessage((message) => {
    logger.success('FCM', 'Foreground notification received!', {
      title: message.notification?.title,
      body: message.notification?.body,
      data: message.data,
    });
    handler(message);
  });
}

/**
 * Handle notification tap when app was in background.
 */
export function onNotificationOpened(
  handler: (message: FirebaseMessagingTypes.RemoteMessage) => void
): () => void {
  logger.info('FCM', 'Notification-opened listener registered');
  return messaging().onNotificationOpenedApp((message) => {
    logger.info('FCM', 'App opened from background notification tap', message.data);
    handler(message);
  });
}

/**
 * Check if app was opened from a quit-state notification tap.
 */
export async function getInitialNotification(): Promise<FirebaseMessagingTypes.RemoteMessage | null> {
  const initial = await messaging().getInitialNotification();
  if (initial) {
    logger.info('FCM', 'App opened from quit-state notification', initial.data);
  } else {
    logger.info('FCM', 'No quit-state notification found');
  }
  return initial;
}

export { subscribeToTokenRefresh };
