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
 * The personalised home feed.
 *
 * Everything here is already ranked by the backend, so the screen deliberately
 * has NO sort control — offering "sort by date" would let the user undo the
 * personalisation that is the point of the product. What it does offer is
 * narrowing: search, source, and a minimum-match slider.
 */
export function FeedScreen({ onOpenPersonalize }: Props) {
  const { deviceId } = useAppContext();
  const { items, loading, refreshing, error, refresh } = useFeed(deviceId);

  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(0);

  /** Only offer source chips for boards actually present in this feed. */
  const availableSources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (sourceFilter && item.source !== sourceFilter) return false;
      if (item.score < minScore) return false;
      if (!needle) return true;
      return `${item.title} ${item.company ?? ''} ${item.location ?? ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [items, query, sourceFilter, minScore]);

  const handleApply = useCallback(
    (job: FeedItem) => {
      if (!deviceId) return;
      applyToJob(deviceId, job.jobKey, job.applyUrl);
    },
    [deviceId]
  );

  const handleToggleSave = useCallback(
    (job: FeedItem) => {
      if (!deviceId) return;
      const action = job.isSaved ? unsaveJob(deviceId, job.jobKey) : saveJob(deviceId, job);
      action.catch((err) => logger.warn('Feed', `Save failed: ${err.message}`));
    },
    [deviceId]
  );

  const handleHide = useCallback(
    (job: FeedItem) => {
      if (!deviceId) return;
      hideJob(deviceId, job).catch((err) => logger.warn('Feed', `Hide failed: ${err.message}`));
    },
    [deviceId]
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

  const topScore = items[0]?.score ?? 0;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="For you"
        subtitle={
          items.length
            ? `${filtered.length} of ${items.length} matches · best ${topScore}%`
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
                  selected={sourceFilter === null}
                  onPress={() => setSourceFilter(null)}
                />
                {availableSources.map(([source, count]) => (
                  <Chip
                    key={source}
                    size="sm"
                    label={`${SOURCE_LABELS[source] ?? source} ${count}`}
                    dotColor={sourceFilter === source ? undefined : sourceColors[source]}
                    selected={sourceFilter === source}
                    onPress={() => setSourceFilter(sourceFilter === source ? null : source)}
                  />
                ))}
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
              icon="🎯"
              title="No matches yet"
              message={
                'Pick your skills, countries and job types in the Personalize tab — new jobs are checked every 2 minutes and only strong matches land here.'
              }
              action={{ label: 'Set up personalization', onPress: onOpenPersonalize }}
            />
          ) : (
            <EmptyState
              icon="🔍"
              title="Nothing matches these filters"
              message={`${items.length} job${items.length === 1 ? '' : 's'} in your feed, but none pass the current search or minimum match.`}
              action={{
                label: 'Clear filters',
                onPress: () => {
                  setQuery('');
                  setSourceFilter(null);
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
