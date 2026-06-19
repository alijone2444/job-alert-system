import { useCallback, useEffect, useState } from 'react';
import { AppHealthStatus, runFullHealthCheck } from '../services/firebaseHealth';
import { logger } from '../utils/logger';

const INITIAL_STATUS: AppHealthStatus = {
  firebaseApp: false,
  projectId: null,
  firestore: 'checking',
  firestoreError: null,
  fcmPermission: 'unknown',
  fcmToken: null,
  deviceId: null,
};

export function useAppStatus(deviceId?: string | null) {
  const [status, setStatus] = useState<AppHealthStatus>(INITIAL_STATUS);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    setChecking(true);
    logger.info('AppStatus', 'Refreshing health status...');
    try {
      const result = await runFullHealthCheck(deviceId ?? undefined);
      setStatus(result);
    } catch (error) {
      logger.error('AppStatus', 'Health check crashed', error);
    } finally {
      setChecking(false);
    }
  }, [deviceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, checking, refresh };
};
