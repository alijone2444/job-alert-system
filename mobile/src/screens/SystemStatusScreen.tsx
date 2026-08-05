import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useBackendStatus } from '../hooks/useBackendStatus';
import { ScreenHeader } from '../components/ScreenHeader';
import { SectionCard } from '../components/SectionCard';
import { colors, radius, sourceColors, spacing } from '../theme';
import { SOURCE_LABELS } from '../domain/taxonomy';

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * Status screen — the system explaining itself.
 *
 * Shows unavailable sources WITH their reason rather than hiding them. When
 * Indeed produces nothing, the honest answer ("Cloudflare-blocked, needs a
 * commercial data partner") is far more useful to the person running this than
 * an absence they have to guess at.
 */
export function SystemStatusScreen() {
  const { status, sources, loading, refresh } = useBackendStatus();

  const tone =
    status.status === 'success' && !status.isStale
      ? { color: colors.success, soft: colors.successSoft, label: 'Healthy' }
      : status.status === 'partial' || status.isStale
        ? {
            color: colors.warning,
            soft: colors.warningSoft,
            label: status.isStale ? 'Stale' : 'Partial',
          }
        : status.status === 'failed'
          ? { color: colors.danger, soft: colors.dangerSoft, label: 'Failed' }
          : { color: colors.textMuted, soft: colors.surfaceMuted, label: 'Unknown' };

  if (loading && !status.found) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Status" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Status" subtitle={`Last run ${relativeTime(status.lastRunAt)}`} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        <SectionCard title="Pipeline">
          <View style={[styles.banner, { backgroundColor: tone.soft }]}>
            <Text style={[styles.bannerText, { color: tone.color }]}>
              {tone.label}
              {status.runSource ? ` · via ${status.runSource}` : ''}
              {status.durationSeconds != null ? ` · ${status.durationSeconds}s` : ''}
            </Text>
          </View>

          {status.fatalError ? <Text style={styles.errorText}>{status.fatalError}</Text> : null}
          {status.error ? <Text style={styles.errorText}>{status.error}</Text> : null}

          {status.ingest ? (
            <View style={styles.statRow}>
              <Stat label="Fetched" value={status.ingest.fetched} />
              <Stat label="Duplicates" value={status.ingest.duplicatesRemoved} />
              <Stat label="New" value={status.ingest.newJobs} />
              <Stat label="Enriched" value={status.ingest.enriched} />
            </View>
          ) : null}
        </SectionCard>

        {status.personalization ? (
          <SectionCard
            title="Personalization"
            subtitle="Every new job is scored against each user's own preferences."
          >
            <View style={styles.statRow}>
              <Stat label="Users" value={status.personalization.users} />
              <Stat label="Feed writes" value={status.personalization.feedEntriesWritten} />
              <Stat label="Notified" value={status.personalization.notificationsSent} />
              <Stat label="Rebuilds" value={status.personalization.feedRebuilds} />
            </View>
          </SectionCard>
        ) : null}

        <SectionCard title="Last run by source">
          {status.sources.length === 0 ? (
            <Text style={styles.muted}>No source reports in the latest run.</Text>
          ) : (
            status.sources.map((source) => (
              <View key={source.sourceId} style={styles.row}>
                <View style={styles.rowLeft}>
                  <View
                    style={[
                      styles.sourceDot,
                      { backgroundColor: sourceColors[source.sourceId] ?? colors.textMuted },
                    ]}
                  />
                  <Text style={styles.rowLabel}>
                    {SOURCE_LABELS[source.sourceId] ?? source.sourceId}
                  </Text>
                </View>

                <View style={styles.rowRight}>
                  <Text style={styles.rowValue}>
                    {source.status === 'ok'
                      ? `${source.jobsFetched} jobs`
                      : source.status === 'skipped'
                        ? 'deferred'
                        : 'error'}
                  </Text>
                  <View
                    style={[
                      styles.pill,
                      source.status === 'ok'
                        ? styles.pillOk
                        : source.status === 'skipped'
                          ? styles.pillWarn
                          : styles.pillError,
                    ]}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        source.status === 'ok'
                          ? styles.pillTextOk
                          : source.status === 'skipped'
                            ? styles.pillTextWarn
                            : styles.pillTextError,
                      ]}
                    >
                      {source.status}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </SectionCard>

        <SectionCard
          title="Sources"
          subtitle="Every board the system knows about, including the ones we cannot fetch yet."
        >
          {sources.length === 0 ? (
            <Text style={styles.muted}>Source registry unavailable.</Text>
          ) : (
            sources.map((source) => (
              <View key={source.id} style={styles.sourceBlock}>
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <View
                      style={[
                        styles.sourceDot,
                        { backgroundColor: sourceColors[source.id] ?? colors.textMuted },
                      ]}
                    />
                    <Text style={styles.rowLabel}>{source.label}</Text>
                  </View>
                  <View style={[styles.pill, source.enabled ? styles.pillOk : styles.pillMuted]}>
                    <Text
                      style={[
                        styles.pillText,
                        source.enabled ? styles.pillTextOk : styles.pillTextMuted,
                      ]}
                    >
                      {source.enabled ? 'live' : 'unavailable'}
                    </Text>
                  </View>
                </View>
                {!source.available && source.unavailableReason ? (
                  <Text style={styles.reason}>{source.unavailableReason}</Text>
                ) : null}
                {source.attribution ? <Text style={styles.reason}>{source.attribution}</Text> : null}
              </View>
            ))
          )}
        </SectionCard>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: spacing.md },

  banner: { borderRadius: radius.md, padding: spacing.md },
  bannerText: { fontSize: 13, fontWeight: '700' },
  errorText: { fontSize: 12, color: colors.danger, marginTop: spacing.sm, lineHeight: 17 },
  muted: { fontSize: 12, color: colors.textSubtle },

  statRow: { flexDirection: 'row', marginTop: spacing.lg, gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 10, fontWeight: '600', color: colors.textSubtle, marginTop: 2 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sourceDot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  rowValue: { fontSize: 12, color: colors.textMuted },

  pill: { borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2 },
  pillOk: { backgroundColor: colors.successSoft },
  pillWarn: { backgroundColor: colors.warningSoft },
  pillError: { backgroundColor: colors.dangerSoft },
  pillMuted: { backgroundColor: colors.surfaceMuted },
  pillText: { fontSize: 10, fontWeight: '700' },
  pillTextOk: { color: colors.success },
  pillTextWarn: { color: colors.warning },
  pillTextError: { color: colors.danger },
  pillTextMuted: { color: colors.textSubtle },

  sourceBlock: { marginBottom: spacing.sm },
  reason: { fontSize: 11, color: colors.textSubtle, lineHeight: 16, marginTop: 2 },
});
