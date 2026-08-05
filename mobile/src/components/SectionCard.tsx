import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, radius, shadow, spacing } from '../theme';

type Props = {
  title: string;
  subtitle?: string;
  /** Number of selected values, shown as a badge so state is visible collapsed. */
  count?: number;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
};

/**
 * A titled group inside Personalize.
 *
 * The count badge exists so a user scrolling a long settings screen can see
 * what they have already chosen without expanding each section — the most
 * common complaint about multi-select settings screens.
 */
export function SectionCard({ title, subtitle, count, action, children }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {count ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{count}</Text>
            </View>
          ) : null}
        </View>

        {action ? (
          <TouchableOpacity onPress={action.onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.action}>{action.label}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  badge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  action: { fontSize: 12, fontWeight: '600', color: colors.primary },
  subtitle: { fontSize: 12, color: colors.textSubtle, marginTop: 4, lineHeight: 17 },
  body: { marginTop: spacing.md },
});
