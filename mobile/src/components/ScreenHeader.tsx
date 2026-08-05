import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme';

type Props = {
  title: string;
  subtitle?: string;
  /** Optional right-hand action, e.g. a filter toggle. */
  action?: { label: string; onPress: () => void; active?: boolean };
};

/**
 * Light header on the app background rather than a coloured bar.
 *
 * The previous version painted a solid blue block above every screen, which
 * competed with the match badges and source colours on the cards below — the
 * two things a user actually needs to read at a glance. Chrome recedes so the
 * data can carry the colour.
 */
export function ScreenHeader({ title, subtitle, action }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.row}>
        <View style={styles.textBlock}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {action ? (
          <TouchableOpacity
            onPress={action.onPress}
            style={[styles.action, action.active && styles.actionActive]}
            activeOpacity={0.8}
          >
            <Text style={[styles.actionText, action.active && styles.actionTextActive]}>
              {action.label}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.background,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textBlock: { flex: 1 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  action: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  actionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  actionTextActive: { color: colors.textInverse },
});
