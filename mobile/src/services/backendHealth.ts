/**
 * Backend health for the Status screen.
 *
 * Reads `cron_status/latest`, which the engine rewrites at the end of every
 * run. The report is source-ARRAY shaped now, so adding a board to the backend
 * makes it appear here with no app change.
 */

import firestore from '@react-native-firebase/firestore';
import { logger } from '../utils/logger';

export type SourceRunReport = {
  sourceId: string;
  status: string;
  jobsFetched: number;
  rejected: number;
  error: string | null;
  durationMs: number;
};

export type BackendStatus = {
  found: boolean;
  lastRunAt: string | null;
  status: 'success' | 'partial' | 'failed' | 'unknown';
  runSource: string | null;
  durationSeconds: number | null;
  fatalError: string | null;
  isStale: boolean;
  sources: SourceRunReport[];
  ingest: {
    fetched: number;
    duplicatesRemoved: number;
    newJobs: number;
    updatedJobs: number;
    enriched: number;
  } | null;
  personalization: {
    users: number;
    feedEntriesWritten: number;
    notificationsSent: number;
    usersNotified: number;
    feedRebuilds: number;
  } | null;
  error: string | null;
};

/** The cron runs every 2 minutes; 15 without a report means something is wrong. */
const STALE_MINUTES = 15;

export const EMPTY_STATUS: BackendStatus = {
  found: false,
  lastRunAt: null,
  status: 'unknown',
  runSource: null,
  durationSeconds: null,
  fatalError: null,
  isStale: true,
  sources: [],
  ingest: null,
  personalization: null,
  error: null,
};

export async function fetchBackendStatus(): Promise<BackendStatus> {
  try {
    const doc = await firestore().doc('cron_status/latest').get();

    // NOTE: `exists` is a METHOD in @react-native-firebase/firestore v22+.
    // Reading it as a property yields a function — always truthy — so the
    // "not found" branch would never run and a missing document would fall
    // through as an empty-but-present report.
    if (!doc.exists()) {
      return { ...EMPTY_STATUS, error: 'The backend has not reported a run yet.' };
    }

    const data = doc.data() ?? {};
    const lastRunAt = data.lastRunAt ? String(data.lastRunAt) : null;
    const isStale = lastRunAt
      ? Date.now() - new Date(lastRunAt).getTime() > STALE_MINUTES * 60 * 1000
      : true;

    return {
      found: true,
      lastRunAt,
      status: (data.status as BackendStatus['status']) ?? 'unknown',
      runSource: data.runSource ? String(data.runSource) : null,
      durationSeconds: data.durationSeconds != null ? Number(data.durationSeconds) : null,
      fatalError: data.fatalError ? String(data.fatalError) : null,
      isStale,
      sources: Array.isArray(data.sources)
        ? data.sources.map((source: Record<string, unknown>) => ({
            sourceId: String(source.sourceId ?? 'unknown'),
            status: String(source.status ?? 'unknown'),
            jobsFetched: Number(source.jobsFetched ?? 0),
            rejected: Number(source.rejected ?? 0),
            error: source.error ? String(source.error) : null,
            durationMs: Number(source.durationMs ?? 0),
          }))
        : [],
      ingest: data.ingest
        ? {
            fetched: Number(data.ingest.fetched ?? 0),
            duplicatesRemoved: Number(data.ingest.duplicatesRemoved ?? 0),
            newJobs: Number(data.ingest.newJobs ?? 0),
            updatedJobs: Number(data.ingest.updatedJobs ?? 0),
            enriched: Number(data.ingest.enriched ?? 0),
          }
        : null,
      personalization: data.personalization
        ? {
            users: Number(data.personalization.users ?? 0),
            feedEntriesWritten: Number(data.personalization.feedEntriesWritten ?? 0),
            notificationsSent: Number(data.personalization.notificationsSent ?? 0),
            usersNotified: Number(data.personalization.usersNotified ?? 0),
            feedRebuilds: Number(data.personalization.feedRebuilds ?? 0),
          }
        : null,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read backend status';
    logger.error('Backend', message);
    return { ...EMPTY_STATUS, error: message };
  }
}
