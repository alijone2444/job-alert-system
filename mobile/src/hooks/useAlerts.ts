import { useCallback, useEffect, useState } from 'react';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { JobAlert } from '../types/job';
import { logger } from '../utils/logger';

const JOBS_COLLECTION = 'jobs';

function mapDocToJob(doc: FirebaseFirestoreTypes.QueryDocumentSnapshot): JobAlert {
  const data = doc.data();
  return {
    id: doc.id,
    jobId: String(data.jobId ?? doc.id),
    platform: String(data.platform ?? 'Unknown'),
    title: String(data.title ?? 'Untitled Job'),
    link: String(data.link ?? ''),
    description: data.description ? String(data.description) : undefined,
    company: data.company ? String(data.company) : undefined,
    location: data.location ? String(data.location) : undefined,
    publishedAt: data.publishedAt ? String(data.publishedAt) : undefined,
    notifiedAt: data.notifiedAt ? String(data.notifiedAt) : undefined,
    createdAt: data.createdAt as JobAlert['createdAt'],
  };
}

function getSortTimestamp(job: JobAlert): number {
  if (job.createdAt && typeof job.createdAt === 'object' && 'seconds' in job.createdAt) {
    return job.createdAt.seconds * 1000;
  }
  if (job.notifiedAt) return new Date(job.notifiedAt).getTime();
  if (job.publishedAt) return new Date(job.publishedAt).getTime();
  return 0;
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<JobAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      setError(null);
      logger.info('Alerts', 'Fetching jobs from Firestore...');

      const snapshot = await firestore()
        .collection(JOBS_COLLECTION)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      const jobs = snapshot.docs.map(mapDocToJob);
      jobs.sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));
      setAlerts(jobs);

      logger.success('Alerts', `Loaded ${jobs.length} job alert(s) from Firestore`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load alerts';
      setError(message);
      logger.error('Alerts', 'Fetch failed', message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    logger.info('Alerts', 'Subscribing to real-time Firestore updates...');
    fetchAlerts();

    const unsubscribe = firestore()
      .collection(JOBS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .onSnapshot(
        (snapshot) => {
          const jobs = snapshot.docs.map(mapDocToJob);
          jobs.sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));
          setAlerts(jobs);
          setLoading(false);
          setError(null);
          logger.info('Alerts', `Real-time update — ${jobs.length} alert(s)`);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
          logger.error('Alerts', 'Real-time listener error', err.message);
        }
      );

    return () => {
      logger.info('Alerts', 'Unsubscribing from Firestore listener');
      unsubscribe();
    };
  }, [fetchAlerts]);

  const refresh = useCallback(() => {
    logger.info('Alerts', 'Manual refresh triggered');
    setRefreshing(true);
    fetchAlerts();
  }, [fetchAlerts]);

  return { alerts, loading, error, refreshing, refresh };
}
