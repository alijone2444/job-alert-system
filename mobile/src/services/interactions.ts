/**
 * Save / hide / apply actions.
 *
 * Each call is optimistic at the UI layer and authoritative on the server: the
 * Firestore listener corrects the local state a moment later, so a failed
 * request self-heals instead of leaving the card permanently wrong.
 */

import { Linking, Alert } from 'react-native';
import { api } from '../api/client';
import { FeedItem, SavedJob } from '../types';
import { logger } from '../utils/logger';

function toSnapshot(job: FeedItem) {
  return {
    title: job.title,
    company: job.company ?? '',
    location: job.location ?? '',
    country: job.country ?? null,
    workplace: job.workplace ?? null,
    jobType: job.jobType ?? null,
    salary: job.salary ?? null,
    source: job.source,
    applyUrl: job.applyUrl,
    postedAt: job.postedAt,
    skills: job.skills.slice(0, 10),
  };
}

export async function saveJob(userId: string, job: FeedItem): Promise<void> {
  await api.interact({ userId, jobKey: job.jobKey, action: 'save', snapshot: toSnapshot(job) });
}

export async function unsaveJob(userId: string, jobKey: string): Promise<void> {
  await api.interact({ userId, jobKey, action: 'unsave' });
}

export async function hideJob(userId: string, job: FeedItem): Promise<void> {
  await api.interact({ userId, jobKey: job.jobKey, action: 'hide', snapshot: toSnapshot(job) });
}

export async function unhideJob(userId: string, jobKey: string): Promise<void> {
  await api.interact({ userId, jobKey, action: 'unhide' });
}

/**
 * Open the ORIGINAL job posting and record the tap.
 *
 * We never replicate an application flow: a LinkedIn job opens LinkedIn, a
 * Greenhouse job opens that company's board. The recording is fire-and-forget
 * so a flaky network can never block the user from applying.
 */
export async function applyToJob(
  userId: string,
  jobKey: string,
  applyUrl: string
): Promise<boolean> {
  if (!applyUrl) {
    Alert.alert('No link', 'This posting has no apply URL.');
    return false;
  }

  api.interact({ userId, jobKey, action: 'apply' }).catch((error) => {
    logger.warn('Interactions', `Could not record apply: ${error.message}`);
  });

  try {
    // NOTE: do NOT use Linking.canOpenURL here — on Android 11+ it returns
    // false for https unless the scheme is declared in the manifest queries,
    // which silently blocked opening jobs in an earlier version of this app.
    await Linking.openURL(applyUrl);
    return true;
  } catch {
    Alert.alert('Could not open link', applyUrl);
    return false;
  }
}

/** A saved job carries its own snapshot, so it opens even after retention prunes it. */
export function applyUrlOf(job: SavedJob): string {
  return job.snapshot?.applyUrl ?? '';
}
