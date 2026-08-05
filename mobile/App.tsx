import React, { useEffect, useCallback, useState } from 'react';
import { Alert, StatusBar } from 'react-native';
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
import { parseRemoteMessageData } from './src/utils/messageData';
import { applyToJob } from './src/services/interactions';
import { colors } from './src/theme';
import { logger } from './src/utils/logger';

export default function App() {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  /**
   * Tapping a job notification opens the ORIGINAL posting and records the tap
   * as an apply — the notification IS the apply button, so the two must not
   * diverge from what the in-app card does.
   */
  const handleNotificationTap = useCallback(
    (data: Record<string, unknown> | undefined, userId: string | null) => {
      const parsed = parseRemoteMessageData(data);
      if (!parsed.applyUrl || !userId || !parsed.jobKey) return;

      logger.info('App', `Opening job from notification: ${parsed.title ?? parsed.jobKey}`);
      applyToJob(userId, parsed.jobKey, parsed.applyUrl);
    },
    []
  );

  useEffect(() => {
    logger.divider('App');
    logger.info('App', 'Job Alert app started');

    let tokenRefreshUnsub: (() => void) | undefined;
    let currentDeviceId: string | null = null;

    async function init() {
      const result = await setupPushNotifications();
      currentDeviceId = result.deviceId;
      setDeviceId(result.deviceId);

      if (!result.permissionGranted) {
        logger.warn('App', 'Notifications disabled by user');
        Alert.alert(
          'Notifications off',
          'Enable notifications in your device settings to be alerted the moment a strong match is posted.'
        );
      }

      if (result.deviceId) {
        tokenRefreshUnsub = subscribeToTokenRefresh(result.deviceId, (token) => {
          logger.info('App', `Token refreshed: ${token.slice(0, 12)}…`);
        });
      }

      // Cold start from a notification tap.
      const initial = await getInitialNotification();
      if (initial?.data) handleNotificationTap(initial.data, result.deviceId);
    }

    init();

    // Foreground pushes are intentionally silent — the feed listener already
    // inserts the card live, so a popup would interrupt the user to tell them
    // about something already on their screen.
    const foregroundUnsub = onForegroundMessage((message) => {
      logger.info('App', `Match arrived in foreground: ${message.notification?.title ?? ''}`);
    });

    const openedUnsub = onNotificationOpened((message) => {
      if (message.data) handleNotificationTap(message.data, currentDeviceId);
    });

    return () => {
      foregroundUnsub();
      openedUnsub();
      tokenRefreshUnsub?.();
    };
  }, [handleNotificationTap]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <AppProvider deviceId={deviceId}>
        <AppNavigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}
