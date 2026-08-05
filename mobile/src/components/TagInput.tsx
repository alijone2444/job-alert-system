import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../theme';

type Props = {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  /** Tint for the chips — companies you block should not look like ones you want. */
  tone?: 'neutral' | 'positive' | 'negative';
  maxValues?: number;
};

/**
 * Free-text multi-value input for company names and keywords.
 *
 * Separate from MultiSelect because these values are NOT drawn from a fixed
 * taxonomy — a user can block any employer, and no canonical list of every
 * company on earth exists. Values are matched by substring on the backend.
 */
export function TagInput({ values, onChange, placeholder, tone = 'neutral', maxValues = 25 }: Props) {
  const [text, setText] = useState('');

  const add = () => {
    const value = text.trim();
    if (!value) return;
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setText('');
      return;
    }
    if (values.length >= maxValues) return;
    onChange([...values, value]);
    setText('');
  };

  const remove = (value: string) => onChange(values.filter((item) => item !== value));

  const chipStyle =
    tone === 'positive' ? styles.chipPositive : tone === 'negative' ? styles.chipNegative : styles.chipNeutral;
  const chipTextStyle =
    tone === 'positive'
      ? styles.chipTextPositive
      : tone === 'negative'
        ? styles.chipTextNegative
        : styles.chipTextNeutral;

  return (
    <View>
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          placeholder={placeholder}
          placeholderTextColor={colors.textSubtle}
          returnKeyType="done"
          autoCapitalize="words"
          autoCorrect={false}
          style={styles.input}
        />
        <TouchableOpacity onPress={add} style={styles.addButton} activeOpacity={0.8}>
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {values.length > 0 ? (
        <View style={styles.chips}>
          {values.map((value) => (
            <TouchableOpacity
              key={value}
              onPress={() => remove(value)}
              style={[styles.chip, chipStyle]}
              activeOpacity={0.7}
              accessibilityLabel={`Remove ${value}`}
            >
              <Text style={[styles.chipText, chipTextStyle]} numberOfLines={1}>
                {value}
              </Text>
              <Text style={[styles.chipRemove, chipTextStyle]}>✕</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 13,
    color: colors.text,
  },
  addButton: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  addButtonText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    maxWidth: 220,
  },
  chipNeutral: { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
  chipPositive: { backgroundColor: colors.successSoft, borderColor: colors.success },
  chipNegative: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  chipText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  chipTextNeutral: { color: colors.textMuted },
  chipTextPositive: { color: colors.success },
  chipTextNegative: { color: colors.danger },
  chipRemove: { fontSize: 10, fontWeight: '700' },
});
