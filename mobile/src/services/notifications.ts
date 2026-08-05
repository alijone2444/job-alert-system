import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';
import { getDeviceId, registerDevice, subscribeToTokenRefresh } from './device';
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
 * Full startup flow: permissions → FCM token → account registration.
 *
 * Takes the signed-in `userId` because the token must be stored against the
 * ACCOUNT, not the handset — otherwise notifications follow the device and a
 * user who signs in on a second phone gets nothing on it.
 */
export async function setupPushNotifications(userId: string): Promise<NotificationSetupResult> {
  logger.divider('PushSetup');
  logger.info('PushSetup', 'Starting push notification setup...');

  const deviceId = await getDeviceId();
  const permissionGranted = await requestNotificationPermission();

  if (!permissionGranted) {
    logger.warn('PushSetup', 'Setup incomplete — permission denied');
    // Still register, so the account exists and the cron builds a feed even
    // without push.
    await registerDevice(userId, null).catch(() => {});
    return { deviceId, fcmToken: null, permissionGranted: false };
  }

  let fcmToken: string | null = null;

  try {
    fcmToken = await messaging().getToken();
    if (fcmToken) {
      logger.success('FCM', `Token received: ${fcmToken.slice(0, 24)}...`);
      await registerDevice(userId, fcmToken);
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
