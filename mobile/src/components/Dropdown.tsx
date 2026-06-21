import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';

export type DropdownOption = { label: string; value: string };

type Props = {
  label: string;
  value: string;
  options: DropdownOption[];
  onSelect: (value: string) => void;
};

export function Dropdown({ label, value, options, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={styles.value} numberOfLines={1}>
          {current}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            {options.map((o) => {
              const active = o.value === value;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={styles.option}
                  onPress={() => {
                    onSelect(o.value);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.optionText, active && styles.optionActive]}>{o.label}</Text>
                  {active && <Text style={styles.check}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  label: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9AA0A6',
    marginBottom: 4,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E8EAED',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  value: { flex: 1, fontSize: 13, fontWeight: '600', color: '#202124' },
  chevron: { fontSize: 12, color: '#5F6368', marginLeft: 6 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  sheetTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9AA0A6',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  optionText: { fontSize: 15, color: '#202124' },
  optionActive: { color: '#1A73E8', fontWeight: '700' },
  check: { color: '#1A73E8', fontSize: 15, fontWeight: '700' },
});
