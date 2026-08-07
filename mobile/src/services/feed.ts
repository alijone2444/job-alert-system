/**
 * Feed data access.
 *
 * The live list comes from a Firestore listener on `users/{id}/feed`, not from
 * the REST endpoint. When the cron scores a new job for this user mid-scroll,
 * the card appears without a refresh — which is the entire point of a job
 * alert app. The REST endpoint remains the interface for pagination and
 * server-side filtering.
 */

import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { FeedItem, SavedJob } from '../types';
import { FEED_PAGE_SIZE } from '../config/env';
import { logger } from '../utils/logger';

function feedRef(userId: string) {
  return firestore().collection('users').doc(userId).collection('feed');
}

function interactionsRef(userId: string) {
  return firestore().collection('users').doc(userId).collection('interactions');
}

function mapFeedItem(doc: FirebaseFirestoreTypes.QueryDocumentSnapshot): FeedItem {
  const data = doc.data();
  return {
    id: doc.id,
    jobKey: String(data.jobKey ?? doc.id),
    score: Number(data.score ?? 0),
    matchedSkills: Array.isArray(data.matchedSkills) ? data.matchedSkills : [],
    reasons: Array.isArray(data.reasons) ? data.reasons : [],
    breakdown: data.breakdown ?? undefined,

    title: String(data.title ?? 'Untitled role'),
    company: data.company ? String(data.company) : undefined,
    location: data.location ? String(data.location) : undefined,
    country: data.country ?? null,
    workplace: data.workplace ?? null,
    jobType: data.jobType ?? null,
    experienceLevel: data.experienceLevel ?? null,
    skills: Array.isArray(data.skills) ? data.skills : [],
    salary: data.salary ?? null,

    applyUrl: String(data.applyUrl ?? ''),
    postedAt: String(data.postedAt ?? ''),

    source: String(data.source ?? 'unknown'),
    sources: Array.isArray(data.sources) ? data.sources : undefined,

    notified: Boolean(data.notified),
    createdAt: data.createdAt,
  };
}

/**
 * Subscribe to the personalised feed, NEWEST FIRST.
 *
 * Relevance decides WHAT is in this collection — the backend only writes a job
 * here if it cleared the user's match threshold. Time decides the ORDER.
 *
 * Those are two different jobs, and separating them is what makes a
 * chronological feed safe: nothing irrelevant can appear just because it is
 * recent, because irrelevant jobs were never written in the first place. The
 * match percentage still rides on every card, so a strong result is still
 * obvious — it is just no longer allowed to pin a two-day-old posting above
 * something that landed a minute ago.
 *
 * @returns unsubscribe
 */
export function subscribeToFeed(
  userId: string,
  onData: (items: FeedItem[]) => void,
  onError: (message: string) => void
): () => void {
  logger.info('Feed', `Subscribing to feed for ${userId}`);

  return feedRef(userId)
    .orderBy('postedAt', 'desc')
    .limit(FEED_PAGE_SIZE)
    .onSnapshot(
      (snapshot) => {
        const items = snapshot.docs.map(mapFeedItem);
        // Same-timestamp postings fall back to the stronger match.
        items.sort((a, b) => {
          const byTime = new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
          return byTime !== 0 ? byTime : b.score - a.score;
        });
        logger.info('Feed', `Live update — ${items.length} matches`);
        onData(items);
      },
      (error) => {
        logger.error('Feed', 'Listener error', error.message);
        onError(error.message);
      }
    );
}

/** Subscribe to saved / hidden / applied state so cards stay in sync. */
export function subscribeToInteractions(
  userId: string,
  onData: (state: { saved: Set<string>; hidden: Set<string>; applied: Set<string> }) => void
): () => void {
  return interactionsRef(userId).onSnapshot(
    (snapshot) => {
      const saved = new Set<string>();
      const hidden = new Set<string>();
      const applied = new Set<string>();

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.state === 'saved') saved.add(doc.id);
        if (data.state === 'hidden') hidden.add(doc.id);
        if (data.appliedAt) applied.add(doc.id);
      });

      onData({ saved, hidden, applied });
    },
    (error) => logger.error('Feed', 'Interactions listener error', error.message)
  );
}

/** Saved jobs, rendered from the snapshot stored on the interaction doc. */
export function subscribeToSaved(
  userId: string,
  onData: (jobs: SavedJob[]) => void
): () => void {
  return interactionsRef(userId)
    .where('state', '==', 'saved')
    .onSnapshot(
      (snapshot) => {
        const jobs = snapshot.docs.map((doc) => ({
          id: doc.id,
          jobKey: String(doc.data().jobKey ?? doc.id),
          state: 'saved' as const,
          appliedAt: doc.data().appliedAt,
          updatedAt: doc.data().updatedAt,
          snapshot: doc.data().snapshot,
        }));
        jobs.sort(
          (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
        );
        onData(jobs);
      },
      (error) => logger.error('Feed', 'Saved listener error', error.message)
    );
}
