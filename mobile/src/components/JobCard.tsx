import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FeedItem } from '../types';
import { Icon } from './Icon';
import { colors, matchTone, radius, shadow, sourceColors, spacing } from '../theme';
import { JOB_TYPES, LEVELS, SKILLS, SOURCE_LABELS, WORKPLACES, labelFor } from '../domain/taxonomy';

type Props = {
  job: FeedItem;
  onApply: (job: FeedItem) => void;
  onToggleSave: (job: FeedItem) => void;
  onHide: (job: FeedItem) => void;
  /** Show the match ring + reasons. Off in Saved, where the score is stale. */
  showMatch?: boolean;
};

/** "3h ago", "2d ago" — absolute dates are useless for judging a job's freshness. */
function relativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return '';

  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatSalary(salary: FeedItem['salary']): string | null {
  if (!salary || (!salary.min && !salary.max)) return null;

  const compact = (value: number) =>
    value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
  const suffix = salary.period === 'hour' ? '/hr' : salary.period === 'month' ? '/mo' : '/yr';

  const range =
    salary.min && salary.max && salary.min !== salary.max
      ? `${compact(salary.min)}–${compact(salary.max)}`
      : compact((salary.max ?? salary.min) as number);

  return `${salary.currency} ${range}${suffix}`;
}

/** The match percentage, as a filled pill. */
function MatchBadge({ score }: { score: number }) {
  const tone = matchTone(score);
  return (
    <View style={[styles.matchBadge, { backgroundColor: tone.soft, borderColor: tone.color }]}>
      <Text style={[styles.matchScore, { color: tone.color }]}>{score}</Text>
      <Text style={[styles.matchPercent, { color: tone.color }]}>%</Text>
    </View>
  );
}

/** Where the job came from — required on every card. */
function SourceBadge({ source, extra }: { source: string; extra?: number }) {
  const color = sourceColors[source] ?? colors.textMuted;
  return (
    <View style={[styles.sourceBadge, { borderColor: color }]}>
      <View style={[styles.sourceDot, { backgroundColor: color }]} />
      <Text style={[styles.sourceText, { color }]} numberOfLines={1}>
        {SOURCE_LABELS[source] ?? source}
        {extra ? ` +${extra}` : ''}
      </Text>
    </View>
  );
}

export function JobCard({ job, onApply, onToggleSave, onHide, showMatch = true }: Props) {
  const meta = useMemo(() => {
    const parts: string[] = [];
    if (job.workplace) parts.push(labelFor(WORKPLACES, job.workplace));
    if (job.jobType) parts.push(labelFor(JOB_TYPES, job.jobType));
    if (job.experienceLevel) parts.push(labelFor(LEVELS, job.experienceLevel));
    return parts;
  }, [job.workplace, job.jobType, job.experienceLevel]);

  const salary = formatSalary(job.salary);
  const extraSources = (job.sources?.length ?? 1) - 1;

  return (
    <View style={[styles.card, job.isApplied && styles.cardApplied]}>
      {/* --- header: title + match ------------------------------------- */}
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={2}>
            {job.title}
          </Text>
          {job.company ? (
            <Text style={styles.company} numberOfLines={1}>
              {job.company}
            </Text>
          ) : null}
        </View>
        {showMatch ? <MatchBadge score={job.score} /> : null}
      </View>

      {/* --- location + posted time ------------------------------------ */}
      <View style={styles.subRow}>
        {job.location ? (
          <Text style={styles.location} numberOfLines={1}>
            {job.location}
          </Text>
        ) : null}
        <Text style={styles.dot}>·</Text>
        <Text style={styles.posted}>{relativeTime(job.postedAt)}</Text>
      </View>

      {/* --- attribute pills ------------------------------------------- */}
      {(meta.length > 0 || salary) && (
        <View style={styles.pillRow}>
          {meta.map((label) => (
            <View key={label} style={styles.pill}>
              <Text style={styles.pillText}>{label}</Text>
            </View>
          ))}
          {salary ? (
            <View style={[styles.pill, styles.pillSalary]}>
              <Text style={[styles.pillText, styles.pillSalaryText]}>{salary}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* --- matched skills -------------------------------------------- */}
      {showMatch && job.matchedSkills.length > 0 ? (
        <View style={styles.skillRow}>
          {job.matchedSkills.slice(0, 4).map((skill) => (
            <View key={skill} style={styles.skillPill}>
              <Text style={styles.skillText}>{labelFor(SKILLS, skill)}</Text>
            </View>
          ))}
          {job.matchedSkills.length > 4 ? (
            <Text style={styles.skillMore}>+{job.matchedSkills.length - 4}</Text>
          ) : null}
        </View>
      ) : null}

      {/* --- why it matched -------------------------------------------- */}
      {showMatch && job.reasons.length > 0 ? (
        <Text style={styles.reasons} numberOfLines={2}>
          {job.reasons.slice(0, 3).join(' · ')}
        </Text>
      ) : null}

      {/* --- footer: source + actions ---------------------------------- */}
      <View style={styles.footer}>
        <SourceBadge source={job.source} extra={extraSources > 0 ? extraSources : undefined} />

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => onHide(job)}
            style={styles.iconButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Hide this job"
          >
            <Icon name="close" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onToggleSave(job)}
            style={[styles.iconButton, job.isSaved && styles.iconButtonActive]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={job.isSaved ? 'Remove from saved' : 'Save this job'}
          >
            <Icon
              name={job.isSaved ? 'star-filled' : 'star'}
              size={17}
              color={job.isSaved ? colors.warning : colors.textMuted}
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onApply(job)}
            style={[styles.applyButton, job.isApplied && styles.applyButtonDone]}
            activeOpacity={0.85}
          >
            <Text style={[styles.applyText, job.isApplied && styles.applyTextDone]}>
              {job.isApplied ? 'Opened' : 'Apply'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  cardApplied: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text, lineHeight: 21 },
  company: { fontSize: 13, fontWeight: '500', color: colors.textMuted, marginTop: 3 },

  matchBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  matchScore: { fontSize: 15, fontWeight: '800' },
  matchPercent: { fontSize: 9, fontWeight: '700', marginLeft: 1 },

  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, gap: 6 },
  location: { fontSize: 12, color: colors.textSubtle, flexShrink: 1 },
  dot: { fontSize: 12, color: colors.textSubtle },
  posted: { fontSize: 12, color: colors.textSubtle },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  pill: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  pillSalary: { backgroundColor: colors.successSoft },
  pillSalaryText: { color: colors.success },

  skillRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  skillPill: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  skillText: { fontSize: 11, fontWeight: '600', color: colors.primary },
  skillMore: { fontSize: 11, fontWeight: '600', color: colors.textSubtle },

  reasons: { fontSize: 11, color: colors.textSubtle, marginTop: spacing.sm, lineHeight: 16 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 150,
  },
  sourceDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  sourceText: { fontSize: 10, fontWeight: '700' },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonActive: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  iconText: { fontSize: 14, color: colors.textMuted },
  iconTextActive: { color: colors.warning },

  applyButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
  },
  applyButtonDone: { backgroundColor: colors.surfaceMuted },
  applyText: { fontSize: 13, fontWeight: '700', color: colors.textInverse },
  applyTextDone: { color: colors.textMuted },
});
