import { useCallback, useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import { BackendCronStatus, fetchBackendCronStatus } from '../services/backendHealth';
import { logger } from '../utils/logger';

const INITIAL: BackendCronStatus = {
  found: false,
  lastRunAt: null,
  status: 'unknown',
  runSource: null,
  durationSeconds: null,
  fatalError: null,
  upwork: null,
  linkedin: null,
  processing: null,
  isStale: true,
  error: null,
};

export function useBackendStatus() {
  const [status, setStatus] = useState<BackendCronStatus>(INITIAL);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    logger.info('BackendStatus', 'Refreshing backend/cron status...');
    const result = await fetchBackendCronStatus();
    setStatus(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    const unsubscribe = firestore()
      .doc('cron_status/latest')
      .onSnapshot(
        () => {
          fetchBackendCronStatus().then(setStatus);
        },
        (err) => logger.error('BackendStatus', 'Listener error', err.message)
      );

    return unsubscribe;
  }, [refresh]);

  return { status, loading, refresh };
}
