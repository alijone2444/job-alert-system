import firestore from '@react-native-firebase/firestore';
import { logger } from '../utils/logger';

export type PlatformFetchStatus = {
  status: string;
  jobsFetched: number;
  error: string | null;
  sampleJobs: Array<{ title: string; link: string; platform: string }>;
};

export type BackendCronStatus = {
  found: boolean;
  lastRunAt: string | null;
  status: 'success' | 'partial' | 'failed' | 'unknown';
  runSource: string | null;
  durationSeconds: number | null;
  fatalError: string | null;
  upwork: PlatformFetchStatus | null;
  linkedin: PlatformFetchStatus | null;
  processing: {
    processed: number;
    skipped: number;
    notified: number;
    errors: number;
  } | null;
  isStale: boolean;
  error: string | null;
};

const STALE_MINUTES = 30;

function mapPlatform(data: Record<string, unknown> | undefined): PlatformFetchStatus | null {
  if (!data) return null;
  return {
    status: String(data.status ?? 'unknown'),
    jobsFetched: Number(data.jobsFetched ?? 0),
    error: data.error ? String(data.error) : null,
    sampleJobs: Array.isArray(data.sampleJobs)
      ? data.sampleJobs.map((job) => ({
          title: String((job as Record<string, unknown>).title ?? ''),
          link: String((job as Record<string, unknown>).link ?? ''),
          platform: String((job as Record<string, unknown>).platform ?? ''),
        }))
      : [],
  };
}

export async function fetchBackendCronStatus(): Promise<BackendCronStatus> {
  const empty: BackendCronStatus = {
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

  try {
    logger.info('Backend', 'Reading cron_status/latest from Firestore...');

    const doc = await firestore().doc('cron_status/latest').get();

    if (!doc.exists) {
      logger.warn('Backend', 'No cron run report found — backend may never have run');
      return {
        ...empty,
        error: 'Backend has not run yet. Trigger GitHub Actions cron or run locally.',
      };
    }

    const data = doc.data() ?? {};
    const lastRunAt = data.lastRunAt ? String(data.lastRunAt) : null;
    const isStale = lastRunAt
      ? Date.now() - new Date(lastRunAt).getTime() > STALE_MINUTES * 60 * 1000
      : true;

    const status: BackendCronStatus = {
      found: true,
      lastRunAt,
      status: (data.status as BackendCronStatus['status']) ?? 'unknown',
      runSource: data.runSource ? String(data.runSource) : null,
      durationSeconds: data.durationSeconds != null ? Number(data.durationSeconds) : null,
      fatalError: data.fatalError ? String(data.fatalError) : null,
      upwork: mapPlatform(data.upwork as Record<string, unknown>),
      linkedin: mapPlatform(data.linkedin as Record<string, unknown>),
      processing: data.processing
        ? {
            processed: Number((data.processing as Record<string, unknown>).processed ?? 0),
            skipped: Number((data.processing as Record<string, unknown>).skipped ?? 0),
            notified: Number((data.processing as Record<string, unknown>).notified ?? 0),
            errors: Number((data.processing as Record<string, unknown>).errors ?? 0),
          }
        : null,
      isStale,
      error: null,
    };

    logger.success('Backend', 'Cron status loaded', {
      lastRun: status.lastRunAt,
      upworkJobs: status.upwork?.jobsFetched,
      linkedinJobs: status.linkedin?.jobsFetched,
      overall: status.status,
    });

    if (status.upwork?.error) {
      logger.error('Backend', `Upwork error: ${status.upwork.error}`);
    }
    if (status.linkedin?.error) {
      logger.error('Backend', `LinkedIn error: ${status.linkedin.error}`);
    }

    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read backend status';
    logger.error('Backend', message, error);
    return { ...empty, error: message };
  }
}
