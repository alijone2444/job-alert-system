import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Chip } from './Chip';
import { Option } from '../domain/taxonomy';
import { colors, radius, spacing } from '../theme';

type Props = {
  options: Option[];
  selected: string[];
  onToggle: (id: string) => void;
  /** Show a search box + collapse the list. For long option sets (skills). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Group chips under their `group` heading. */
  grouped?: boolean;
  /** How many chips to show before "Show all". */
  collapseAfter?: number;
};

/**
 * Multi-select chip grid.
 *
 * Three behaviours that matter for a 45-item skill list on a phone:
 *  - SELECTED FIRST. Once you pick React it stays at the top, so you can see
 *    your profile without scrolling back.
 *  - SEARCH. Typing "type" surfaces TypeScript instantly.
 *  - COLLAPSE. Long lists show a slice with "Show all", so the Personalize
 *    screen stays scannable instead of becoming a wall of chips.
 */
export function MultiSelect({
  options,
  selected,
  onToggle,
  searchable = false,
  searchPlaceholder = 'Search…',
  grouped = false,
  collapseAfter,
}: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options;

    // Selected options float to the top so the current choice is always visible.
    return [...matches].sort((a, b) => {
      const aSelected = selectedSet.has(a.id) ? 0 : 1;
      const bSelected = selectedSet.has(b.id) ? 0 : 1;
      return aSelected - bSelected;
    });
  }, [options, query, selectedSet]);

  const shouldCollapse = Boolean(collapseAfter) && !expanded && !query && filtered.length > collapseAfter!;
  const visible = shouldCollapse ? filtered.slice(0, collapseAfter) : filtered;

  if (grouped && !query) {
    const groups = [...new Set(options.map((option) => option.group).filter(Boolean))] as string[];

    return (
      <View>
        {searchable ? <SearchBox value={query} onChange={setQuery} placeholder={searchPlaceholder} /> : null}
        {groups.map((group) => {
          const groupOptions = filtered.filter((option) => option.group === group);
          if (!groupOptions.length) return null;
          return (
            <View key={group} style={styles.group}>
              <Text style={styles.groupLabel}>{group}</Text>
              <View style={styles.grid}>
                {groupOptions.map((option) => (
                  <Chip
                    key={option.id}
                    label={option.label}
                    selected={selectedSet.has(option.id)}
                    onPress={() => onToggle(option.id)}
                  />
                ))}
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <View>
      {searchable ? <SearchBox value={query} onChange={setQuery} placeholder={searchPlaceholder} /> : null}

      <View style={styles.grid}>
        {visible.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={selectedSet.has(option.id)}
            onPress={() => onToggle(option.id)}
          />
        ))}
      </View>

      {visible.length === 0 ? <Text style={styles.empty}>No matches for “{query}”.</Text> : null}

      {shouldCollapse ? (
        <TouchableOpacity onPress={() => setExpanded(true)} style={styles.showAll}>
          <Text style={styles.showAllText}>Show all {filtered.length}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.textSubtle}
      autoCorrect={false}
      autoCapitalize="none"
      style={styles.search}
    />
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  group: { marginBottom: spacing.md },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  search: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: 13,
    color: colors.text,
    marginBottom: spacing.md,
  },
  showAll: { marginTop: spacing.md, alignSelf: 'flex-start' },
  showAllText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  empty: { fontSize: 12, color: colors.textSubtle, marginTop: spacing.sm },
});
