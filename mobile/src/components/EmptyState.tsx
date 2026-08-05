import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon, IconName } from './Icon';
import { colors, radius, spacing } from '../theme';

type Props = {
  icon: IconName;
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
};

/**
 * Empty states always explain WHY and offer the next step.
 *
 * "No jobs" on a personalised feed is ambiguous — it could mean nothing was
 * posted, or that the user's threshold is too high. Guessing wrong makes the
 * app look broken, so the caller passes the specific reason.
 */
export function EmptyState({ icon, title, message, action }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Icon name={icon} size={30} color={colors.textSubtle} weight={1.7} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {action ? (
        <TouchableOpacity onPress={action.onPress} style={styles.button} activeOpacity={0.85}>
          <Text style={styles.buttonText}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  message: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 300,
  },
  button: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
  },
  buttonText: { fontSize: 13, fontWeight: '700', color: colors.textInverse },
});
