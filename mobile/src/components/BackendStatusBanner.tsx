import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { BackendCronStatus } from '../services/backendHealth';

type Props = {
  status: BackendCronStatus;
  loading: boolean;
  onRefresh: () => void;
};

function Dot({ ok, neutral }: { ok: boolean; neutral?: boolean }) {
  const color = neutral ? '#9AA0A6' : ok ? '#34A853' : '#EA4335';
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function platformLine(
  name: string,
  platform: BackendCronStatus['upwork']
): { ok: boolean; neutral?: boolean; label: string; detail: string } {
  if (!platform) {
    return { ok: false, label: name, detail: 'No data' };
  }
  if (platform.status === 'disabled') {
    return { ok: true, neutral: true, label: name, detail: 'Disabled (parked)' };
  }
  if (platform.status === 'error') {
    return { ok: false, label: name, detail: platform.error ?? 'Fetch failed' };
  }
  return {
    ok: platform.jobsFetched > 0 || platform.status === 'ok',
    label: name,
    detail: `${platform.jobsFetched} job(s) fetched`,
  };
}

export function BackendStatusBanner({ status, loading, onRefresh }: Props) {
  const upwork = platformLine('Upwork', status.upwork);
  const linkedin = platformLine('LinkedIn', status.linkedin);
  const cronOk = status.found && !status.isStale && status.status !== 'failed';

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.title}>Backend / Cron Status</Text>
        <TouchableOpacity onPress={onRefresh} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color="#1A73E8" />
          ) : (
            <Text style={styles.refresh}>Refresh</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.summaryRow}>
        <Dot ok={cronOk} />
        <View style={styles.summaryText}>
          <Text style={styles.summaryTitle}>
            {!status.found
              ? 'Backend not run yet'
              : status.isStale
                ? 'Cron may be stale (>30 min)'
                : status.status === 'success'
                  ? 'Backend running OK'
                  : status.status === 'partial'
                    ? 'Partial success — check errors'
                    : 'Backend / cron failed'}
          </Text>
          <Text style={styles.summaryMeta}>
            Last run: {formatTime(status.lastRunAt)}
            {status.runSource ? ` · ${status.runSource}` : ''}
            {status.durationSeconds != null ? ` · ${status.durationSeconds}s` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        <View style={styles.item}>
          <Dot ok={upwork.ok} neutral={upwork.neutral} />
          <Text style={styles.label}>{upwork.label}</Text>
          <Text style={styles.value}>{upwork.detail}</Text>
        </View>
        <View style={styles.item}>
          <Dot ok={linkedin.ok} />
          <Text style={styles.label}>{linkedin.label}</Text>
          <Text style={styles.value}>{linkedin.detail}</Text>
        </View>
      </View>

      {status.processing && (
        <Text style={styles.meta}>
          Processed: {status.processing.processed} · New alerts: {status.processing.notified} ·
          Skipped: {status.processing.skipped} · Errors: {status.processing.errors}
        </Text>
      )}

      {status.fatalError && <Text style={styles.errorText}>Fatal: {status.fatalError}</Text>}
      {status.error && <Text style={styles.errorText}>{status.error}</Text>}
      {status.upwork?.error && (
        <Text style={styles.errorText}>Upwork: {status.upwork.error}</Text>
      )}
      {status.linkedin?.error && (
        <Text style={styles.errorText}>LinkedIn: {status.linkedin.error}</Text>
      )}

      {!status.found && (
        <Text style={styles.hint}>
          Run backend locally (backend/npm start) or trigger GitHub Actions → Job Alert Cron → Run
          workflow.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#202124',
  },
  refresh: {
    fontSize: 13,
    color: '#1A73E8',
    fontWeight: '600',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
    gap: 8,
  },
  summaryText: {
    flex: 1,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#202124',
  },
  summaryMeta: {
    fontSize: 11,
    color: '#5F6368',
    marginTop: 2,
  },
  grid: {
    flexDirection: 'row',
    gap: 8,
  },
  item: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 6,
  },
  label: {
    fontSize: 11,
    color: '#5F6368',
    marginBottom: 2,
  },
  value: {
    fontSize: 12,
    fontWeight: '600',
    color: '#202124',
  },
  meta: {
    marginTop: 8,
    fontSize: 11,
    color: '#5F6368',
  },
  errorText: {
    marginTop: 6,
    fontSize: 11,
    color: '#C5221F',
  },
  hint: {
    marginTop: 8,
    fontSize: 11,
    color: '#1A73E8',
    lineHeight: 16,
  },
});
