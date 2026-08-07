import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useAppContext } from '../context/AppContext';
import { useFeed } from '../hooks/useFeed';
import { JobCard } from '../components/JobCard';
import { Chip } from '../components/Chip';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { FeedItem } from '../types';
import { SOURCE_LABELS } from '../domain/taxonomy';
import { applyToJob, hideJob, saveJob, unsaveJob } from '../services/interactions';
import { colors, radius, sourceColors, spacing } from '../theme';
import { logger } from '../utils/logger';

type Props = { onOpenPersonalize: () => void };

/**
 * The personalised home feed — NEWEST FIRST.
 *
 * An earlier version ranked by match percentage and deliberately offered no
 * sort control, on the argument that sorting by date would undo the
 * personalisation. That conflated two separate things: relevance decides WHAT
 * reaches this screen (the backend only writes a job above the user's
 * threshold), and time decides the ORDER. Chronological order cannot surface
 * anything irrelevant, because irrelevant jobs never arrive.
 *
 * It also fixes a real problem: a strong match from two days ago sat
 * permanently at the top, so the feed looked frozen even while new jobs were
 * flowing in underneath it. The percentage still rides on every card, and the
 * "Min match" filter still narrows by relevance.
 */
export function FeedScreen({ onOpenPersonalize }: Props) {
  const { userId } = useAppContext();
  const { items, loading, refreshing, error, refresh } = useFeed(userId);

  const [query, setQuery] = useState('');
  /**
   * MULTI-select, like every other selector in the app. Empty = "All sources".
   * Selecting LinkedIn and Ashby shows exactly those two — a single-choice
   * filter would have been the one place the app forced a either/or.
   */
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [minScore, setMinScore] = useState(0);

  const toggleSource = useCallback((source: string) => {
    setSourceFilter((current) =>
      current.includes(source) ? current.filter((id) => id !== source) : [...current, source]
    );
  }, []);

  /** Only offer source chips for boards actually present in this feed. */
  const availableSources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      // Empty selection means "All sources".
      if (sourceFilter.length && !sourceFilter.includes(item.source)) return false;
      if (item.score < minScore) return false;
      if (!needle) return true;
      return `${item.title} ${item.company ?? ''} ${item.location ?? ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [items, query, sourceFilter, minScore]);

  const handleApply = useCallback(
    (job: FeedItem) => {
      if (!userId) return;
      applyToJob(userId, job.jobKey, job.applyUrl);
    },
    [userId]
  );

  const handleToggleSave = useCallback(
    (job: FeedItem) => {
      if (!userId) return;
      const action = job.isSaved ? unsaveJob(userId, job.jobKey) : saveJob(userId, job);
      action.catch((err) => logger.warn('Feed', `Save failed: ${err.message}`));
    },
    [userId]
  );

  const handleHide = useCallback(
    (job: FeedItem) => {
      if (!userId) return;
      hideJob(userId, job).catch((err) => logger.warn('Feed', `Hide failed: ${err.message}`));
    },
    [userId]
  );

  if (loading && items.length === 0) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="For you" subtitle="Loading your matches…" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  // The first card is now the NEWEST, not the strongest — so report the best
  // match across the whole feed rather than whatever happens to be on top.
  const bestScore = items.reduce((best, item) => Math.max(best, item.score), 0);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="For you"
        subtitle={
          items.length
            ? `${filtered.length} of ${items.length} matches · newest first · best ${bestScore}%`
            : 'No matches yet'
        }
      />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <JobCard
            job={item}
            onApply={handleApply}
            onToggleSave={handleToggleSave}
            onHide={handleHide}
          />
        )}
        contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <View style={styles.controls}>
            <TextInput
              style={styles.search}
              placeholder="Search title, company, location…"
              placeholderTextColor={colors.textSubtle}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />

            {availableSources.length > 1 ? (
              <View style={styles.chipRow}>
                <Chip
                  label="All sources"
                  size="sm"
                  selected={sourceFilter.length === 0}
                  onPress={() => setSourceFilter([])}
                />
                {availableSources.map(([source, count]) => {
                  const selected = sourceFilter.includes(source);
                  return (
                    <Chip
                      key={source}
                      size="sm"
                      label={`${SOURCE_LABELS[source] ?? source} ${count}`}
                      dotColor={selected ? undefined : sourceColors[source]}
                      selected={selected}
                      onPress={() => toggleSource(source)}
                    />
                  );
                })}
              </View>
            ) : null}

            <View style={styles.chipRow}>
              <Text style={styles.filterLabel}>Min match</Text>
              {[0, 70, 80, 90].map((threshold) => (
                <Chip
                  key={threshold}
                  size="sm"
                  label={threshold === 0 ? 'Any' : `${threshold}%+`}
                  selected={minScore === threshold}
                  onPress={() => setMinScore(threshold)}
                />
              ))}
            </View>

            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          items.length === 0 ? (
            <EmptyState
              icon="target"
              title="No matches yet"
              message={
                'Pick your skills, countries and job types in the Personalize tab — new jobs are checked every 2 minutes and only strong matches land here.'
              }
              action={{ label: 'Set up personalization', onPress: onOpenPersonalize }}
            />
          ) : (
            <EmptyState
              icon="search"
              title="Nothing matches these filters"
              message={`${items.length} job${items.length === 1 ? '' : 's'} in your feed, but none pass the current search or minimum match.`}
              action={{
                label: 'Clear filters',
                onPress: () => {
                  setQuery('');
                  setSourceFilter([]);
                  setMinScore(0);
                },
              }}
            />
          )
        }
        ListFooterComponent={
          filtered.length > 0 ? (
            <TouchableOpacity onPress={onOpenPersonalize} style={styles.footerHint} activeOpacity={0.7}>
              <Text style={styles.footerHintText}>
                Not seeing the right roles? Tune your preferences →
              </Text>
            </TouchableOpacity>
          ) : null
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

  controls: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.text,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  filterLabel: { fontSize: 11, fontWeight: '700', color: colors.textSubtle, marginRight: 2 },

  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { color: colors.danger, fontSize: 12 },

  footerHint: { alignItems: 'center', paddingVertical: spacing.lg },
  footerHintText: { fontSize: 12, fontWeight: '600', color: colors.primary },
});
