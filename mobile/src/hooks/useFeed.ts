/**
 * Feed state: live matches merged with the user's interaction state.
 *
 * Hidden jobs are filtered HERE rather than server-side so the "Undo" that
 * follows a hide is instant — the item is already in memory. The backend also
 * respects hides during fan-out, so the two agree; this is the fast path, not
 * the only path.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FeedItem } from '../types';
import { subscribeToFeed, subscribeToInteractions } from '../services/feed';
import { api } from '../api/client';
import { logger } from '../utils/logger';

type InteractionState = {
  saved: Set<string>;
  hidden: Set<string>;
  applied: Set<string>;
};

const EMPTY_STATE: InteractionState = {
  saved: new Set(),
  hidden: new Set(),
  applied: new Set(),
};

export function useFeed(userId: string | null) {
  const [raw, setRaw] = useState<FeedItem[]>([]);
  const [states, setStates] = useState<InteractionState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    setLoading(true);
    const unsubscribeFeed = subscribeToFeed(
      userId,
      (items) => {
        setRaw(items);
        setLoading(false);
        setError(null);
      },
      (message) => {
        setError(message);
        setLoading(false);
      }
    );

    const unsubscribeStates = subscribeToInteractions(userId, setStates);

    return () => {
      unsubscribeFeed();
      unsubscribeStates();
    };
  }, [userId]);

  /** Ask the backend to rescore the whole recent pool against current prefs. */
  const refresh = useCallback(async () => {
    if (!userId) return;
    setRefreshing(true);
    try {
      const result = await api.rescore(userId);
      logger.success('Feed', `Rescored — ${result.matched}/${result.scanned} matched`);
      setError(null);
    } catch (err) {
      // The listener keeps showing cached results, so this is a soft failure.
      logger.warn('Feed', `Refresh failed: ${(err as Error).message}`);
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  const items = useMemo(
    () =>
      raw
        .filter((item) => !states.hidden.has(item.jobKey))
        .map((item) => ({
          ...item,
          isSaved: states.saved.has(item.jobKey),
          isApplied: states.applied.has(item.jobKey),
        })),
    [raw, states]
  );

  return { items, loading, refreshing, error, refresh, hiddenCount: states.hidden.size };
}
