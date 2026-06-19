import React, { useEffect, useCallback, useState } from 'react';
import { Alert, Linking, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from './src/context/AppContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import {
  setupPushNotifications,
  onForegroundMessage,
  onNotificationOpened,
  getInitialNotification,
  subscribeToTokenRefresh,
} from './src/services/notifications';
import { getMessageLink } from './src/utils/messageData';
import { logger } from './src/utils/logger';

export default function App() {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const handleNotificationTap = useCallback((data: Record<string, unknown> | undefined) => {
    const link = getMessageLink(data);
    if (link) {
      logger.info('App', `Opening job link: ${link}`);
      Linking.openURL(link).catch(() => {
        Alert.alert('Error', 'Could not open the job link.');
      });
    }
  }, []);

  useEffect(() => {
    logger.divider('App');
    logger.info('App', 'Job Alert app started');

    let tokenRefreshUnsub: (() => void) | undefined;

    async function init() {
      const result = await setupPushNotifications();
      setDeviceId(result.deviceId);

      if (!result.permissionGranted) {
        logger.warn('App', 'Notifications disabled by user');
        Alert.alert(
          'Notifications Disabled',
          'Enable push notifications in your device settings to receive instant job alerts.'
        );
      } else {
        logger.success('App', 'Push notifications ready');
      }

      if (result.deviceId) {
        tokenRefreshUnsub = subscribeToTokenRefresh(result.deviceId, (token) => {
          logger.info('App', `Token refreshed: ${token.slice(0, 12)}…`);
        });
      }

      const initial = await getInitialNotification();
      if (initial?.data) {
        handleNotificationTap(initial.data);
      }
    }

    init();

    const foregroundUnsub = onForegroundMessage((message) => {
      const title = message.notification?.title ?? 'New Job Alert';
      const body = message.notification?.body ?? '';
      const link = getMessageLink(message.data);

      Alert.alert(title, body, [
        { text: 'Dismiss', style: 'cancel' },
        {
          text: 'View Job',
          onPress: () => {
            if (link) Linking.openURL(link);
          },
        },
      ]);
    });

    const openedUnsub = onNotificationOpened((message) => {
      if (message.data) {
        handleNotificationTap(message.data);
      }
    });

    return () => {
      logger.info('App', 'Cleaning up listeners');
      foregroundUnsub();
      openedUnsub();
      tokenRefreshUnsub?.();
    };
  }, [handleNotificationTap]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#1A73E8" />
      <AppProvider deviceId={deviceId}>
        <AppNavigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}
