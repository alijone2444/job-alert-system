import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useAppContext } from '../context/AppContext';
import { subscribeToSaved } from '../services/feed';
import { applyToJob, unsaveJob } from '../services/interactions';
import { JobCard } from '../components/JobCard';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { FeedItem, SavedJob } from '../types';
import { colors, spacing } from '../theme';
import { logger } from '../utils/logger';

/**
 * Saved jobs.
 *
 * Rendered from the SNAPSHOT stored on each interaction document, not from the
 * shared `jobs` collection. Jobs are pruned after 30 days, and a saved job
 * vanishing because of a retention job the user never heard of would be a
 * bug they could not explain. The snapshot makes Saved permanent.
 *
 * Match scores are hidden here: the score was computed against the preferences
 * in force when the job was saved, so showing it later would be a stale number
 * presented as a current one.
 */
export function SavedScreen() {
  const { userId } = useAppContext();
  const [saved, setSaved] = useState<SavedJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    return subscribeToSaved(userId, (jobs) => {
      setSaved(jobs);
      setLoading(false);
    });
  }, [userId]);

  const toFeedItem = useCallback((job: SavedJob): FeedItem => {
    const snapshot = job.snapshot;
    return {
      id: job.id,
      jobKey: job.jobKey,
      score: 0,
      matchedSkills: [],
      reasons: [],
      title: snapshot?.title ?? 'Saved job',
      company: snapshot?.company,
      location: snapshot?.location,
      country: snapshot?.country ?? null,
      workplace: snapshot?.workplace ?? null,
      jobType: snapshot?.jobType ?? null,
      experienceLevel: null,
      skills: snapshot?.skills ?? [],
      salary: snapshot?.salary ?? null,
      applyUrl: snapshot?.applyUrl ?? '',
      postedAt: snapshot?.postedAt ?? '',
      source: snapshot?.source ?? 'unknown',
      isSaved: true,
      isApplied: Boolean(job.appliedAt),
    };
  }, []);

  const handleApply = useCallback(
    (job: FeedItem) => {
      if (!userId) return;
      applyToJob(userId, job.jobKey, job.applyUrl);
    },
    [userId]
  );

  const handleUnsave = useCallback(
    (job: FeedItem) => {
      if (!userId) return;
      unsaveJob(userId, job.jobKey).catch((error) =>
        logger.warn('Saved', `Unsave failed: ${error.message}`)
      );
    },
    [userId]
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Saved" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  const appliedCount = saved.filter((job) => job.appliedAt).length;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Saved"
        subtitle={
          saved.length
            ? `${saved.length} saved · ${appliedCount} opened`
            : 'Jobs you star will live here'
        }
      />

      <FlatList
        data={saved}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <JobCard
            job={toFeedItem(item)}
            showMatch={false}
            onApply={handleApply}
            onToggleSave={handleUnsave}
            onHide={handleUnsave}
          />
        )}
        contentContainerStyle={saved.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="bookmark"
            title="Nothing saved yet"
            message="Tap the star on any job in your feed to keep it here. Saved jobs stay even after the listing is cleared from the system."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingTop: spacing.md, paddingBottom: spacing.xxl },
  emptyList: { flexGrow: 1 },
});
