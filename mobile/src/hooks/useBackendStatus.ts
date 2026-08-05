import { useCallback, useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import { BackendStatus, EMPTY_STATUS, fetchBackendStatus } from '../services/backendHealth';
import { api } from '../api/client';
import { SourceInfo } from '../types';
import { logger } from '../utils/logger';

/**
 * Backend health + the source registry.
 *
 * The run report comes from Firestore (live, so the screen updates the moment
 * a cron cycle finishes); the registry comes from the API because it includes
 * sources that are declared but unavailable, which never appear in a run.
 */
export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>(EMPTY_STATUS);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [nextStatus] = await Promise.all([fetchBackendStatus()]);
    setStatus(nextStatus);

    try {
      const result = await api.getSources();
      setSources(result.sources ?? []);
    } catch (error) {
      // The registry is supplementary — a failure must not blank the screen.
      logger.warn('Status', `Could not load source registry: ${(error as Error).message}`);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();

    const unsubscribe = firestore()
      .doc('cron_status/latest')
      .onSnapshot(
        () => {
          fetchBackendStatus().then(setStatus);
        },
        (error) => logger.error('Status', 'Listener error', error.message)
      );

    return unsubscribe;
  }, [refresh]);

  return { status, sources, loading, refresh };
}
