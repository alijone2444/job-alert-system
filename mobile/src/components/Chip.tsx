import React from 'react';
import { Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Small dot before the label — used for source colours. */
  dotColor?: string;
  size?: 'sm' | 'md';
  style?: ViewStyle;
  disabled?: boolean;
};

/**
 * The multi-select primitive used everywhere in Personalize.
 *
 * A chip, not a checkbox row: chips wrap, so 45 skills fit on one screen you
 * can scan, and the selected set stays visible while you pick more. Selection
 * is never exclusive — tapping a second chip adds to the set.
 */
export function Chip({ label, selected, onPress, dotColor, size = 'md', style, disabled }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: Boolean(selected) }}
      style={[
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        selected ? styles.selected : styles.unselected,
        disabled && styles.disabled,
        style,
      ]}
    >
      {dotColor ? <Text style={[styles.dot, { color: dotColor }]}>●</Text> : null}
      <Text
        numberOfLines={1}
        style={[
          size === 'sm' ? styles.labelSm : styles.labelMd,
          selected ? styles.labelSelected : styles.labelUnselected,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  sm: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  md: { paddingHorizontal: spacing.md, paddingVertical: 7 },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  unselected: { backgroundColor: colors.surface, borderColor: colors.border },
  disabled: { opacity: 0.45 },
  dot: { fontSize: 8, marginRight: 5 },
  labelSm: { fontSize: 11, fontWeight: '600' },
  labelMd: { fontSize: 13, fontWeight: '600' },
  labelSelected: { color: colors.textInverse },
  labelUnselected: { color: colors.textMuted },
});
