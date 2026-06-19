import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { JobAlert } from '../types/job';

type Props = {
  job: JobAlert;
  onPress: (job: JobAlert) => void;
};

function formatDate(job: JobAlert): string {
  const raw =
    job.notifiedAt ||
    job.publishedAt ||
    (job.createdAt && typeof job.createdAt === 'object' && 'seconds' in job.createdAt
      ? new Date(job.createdAt.seconds * 1000).toISOString()
      : null);

  if (!raw) return '';
  const date = new Date(raw);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function platformColor(platform: string): string {
  if (platform === 'LinkedIn') return '#0A66C2';
  if (platform === 'Upwork') return '#14A800';
  return '#5F6368';
}

export function AlertItem({ job, onPress }: Props) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(job)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: platformColor(job.platform) }]}>
          <Text style={styles.badgeText}>{job.platform}</Text>
        </View>
        <Text style={styles.date}>{formatDate(job)}</Text>
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {job.title}
      </Text>

      {(job.company || job.location) && (
        <Text style={styles.meta} numberOfLines={1}>
          {[job.company, job.location].filter(Boolean).join(' · ')}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  date: {
    fontSize: 12,
    color: '#9AA0A6',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#202124',
    lineHeight: 22,
  },
  meta: {
    marginTop: 6,
    fontSize: 13,
    color: '#5F6368',
  },
});
