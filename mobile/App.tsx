import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useAppContext } from './src/context/AppContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { SignInScreen } from './src/screens/SignInScreen';
import { InAppAlert } from './src/components/InAppAlert';
import { RemoteMessageData } from './src/types';
import {
  setupPushNotifications,
  onForegroundMessage,
  onNotificationOpened,
  getInitialNotification,
  subscribeToTokenRefresh,
} from './src/services/notifications';
import { parseRemoteMessageData } from './src/utils/messageData';
import { applyToJob } from './src/services/interactions';
import { claimDeviceData } from './src/services/device';
import { colors } from './src/theme';
import { logger } from './src/utils/logger';

/**
 * Everything below the sign-in gate.
 *
 * Push setup is deliberately deferred until AFTER sign-in: the FCM token must
 * be stored against the account, not the handset. Registering it earlier would
 * key notifications to a device id the backend no longer uses.
 */
function AuthedApp() {
  const { userId } = useAppContext();
  const [ready, setReady] = useState(false);
  const [inAppAlert, setInAppAlert] = useState<RemoteMessageData | null>(null);

  const handleNotificationTap = useCallback(
    (data: Record<string, unknown> | undefined, uid: string | null) => {
      const parsed = parseRemoteMessageData(data);
      if (!parsed.applyUrl || !uid || !parsed.jobKey) return;

      logger.info('App', `Opening job from notification: ${parsed.title ?? parsed.jobKey}`);
      applyToJob(uid, parsed.jobKey, parsed.applyUrl);
    },
    []
  );

  const openInAppAlert = useCallback(
    (alert: RemoteMessageData) => {
      setInAppAlert(null);
      if (!alert.applyUrl || !alert.jobKey || !userId) return;
      applyToJob(userId, alert.jobKey, alert.applyUrl);
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) return;

    let tokenRefreshUnsub: (() => void) | undefined;
    let cancelled = false;

    async function init() {
      const result = await setupPushNotifications(userId!);
      if (cancelled) return;

      if (!result.permissionGranted) {
        logger.warn('App', 'Notifications disabled by user');
        Alert.alert(
          'Notifications off',
          'Enable notifications in your device settings to be alerted the moment a strong match is posted.'
        );
      }

      // Pull anything this handset collected before accounts existed into the
      // signed-in profile. No-ops after the first successful run.
      if (result.deviceId) await claimDeviceData(result.deviceId);

      tokenRefreshUnsub = subscribeToTokenRefresh(userId!, (token) => {
        logger.info('App', `Token refreshed: ${token.slice(0, 12)}…`);
      });

      const initial = await getInitialNotification();
      if (initial?.data) handleNotificationTap(initial.data, userId);

      setReady(true);
    }

    init();

    /**
     * A push that lands while the app is open gets an in-app banner, not an OS
     * popup.
     *
     * This used to only write a log line — the message was received and then
     * dropped entirely. That looked exactly like "notifications are broken":
     * anyone testing with the app open saw nothing at all, and a match arriving
     * while they were on Saved or Personalize was announced nowhere, since
     * neither of those screens shows the feed.
     */
    const foregroundUnsub = onForegroundMessage((message) => {
      const parsed = parseRemoteMessageData(message.data);
      logger.info('App', `Match arrived in foreground: ${parsed.title ?? ''}`);
      if (parsed.jobKey || parsed.type === 'digest') setInAppAlert(parsed);
    });

    const openedUnsub = onNotificationOpened((message) => {
      if (message.data) handleNotificationTap(message.data, userId);
    });

    return () => {
      cancelled = true;
      foregroundUnsub();
      openedUnsub();
      tokenRefreshUnsub?.();
    };
  }, [userId, handleNotificationTap]);

  // The navigator mounts immediately; `ready` only gates nothing visible today
  // but keeps the init promise observable for future splash work.
  void ready;

  return (
    <>
      <AppNavigator />
      <InAppAlert
        alert={inAppAlert}
        onOpen={openInAppAlert}
        onDismiss={() => setInAppAlert(null)}
      />
    </>
  );
}

function Gate() {
  const { userId, initializing } = useAppContext();

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return userId ? <AuthedApp /> : <SignInScreen />;
}

export default function App() {
  useEffect(() => {
    logger.divider('App');
    logger.info('App', 'Job Alert started');
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <AppProvider>
        <Gate />
      </AppProvider>
    </SafeAreaProvider>
  );
}
