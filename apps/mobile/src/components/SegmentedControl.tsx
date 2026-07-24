import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  collapseAfter?: number;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  collapseAfter = 4,
  disabled = false
}: SegmentedControlProps<T>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  if (options.length > collapseAfter) {
    const selectedLabel = selectedOption?.label ?? value;

    return (
      <View style={styles.dropdown}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled, expanded: open }}
          disabled={disabled}
          onPress={() => setOpen((current) => !current)}
          style={[styles.trigger, disabled ? styles.disabled : null]}
        >
          <Text numberOfLines={1} style={styles.triggerLabel}>{selectedLabel}</Text>
          <Text style={styles.chevron}>{open ? '^' : 'v'}</Text>
        </Pressable>
        <Modal animationType="fade" transparent visible={open} onRequestClose={() => setOpen(false)}>
          <Pressable
            accessibilityLabel={selectedLabel}
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={styles.modalBackdrop}
          >
            <View
              accessibilityLabel={selectedLabel}
              accessibilityViewIsModal
              onAccessibilityEscape={() => setOpen(false)}
              onStartShouldSetResponder={() => true}
              style={styles.modalSheet}
            >
              <ScrollView accessibilityRole="radiogroup" contentContainerStyle={styles.radioList} style={styles.modalScroll}>
                {options.map((option) => {
                  const selected = option.value === value;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ disabled, selected }}
                      disabled={disabled}
                      key={option.value}
                      onPress={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      style={[styles.radioOption, selected ? styles.radioOptionSelected : null]}
                    >
                      <View style={[styles.radioOuter, selected ? styles.radioOuterSelected : null]}>
                        {selected ? <View style={styles.radioInner} /> : null}
                      </View>
                      <Text style={[styles.label, selected ? styles.radioLabelSelected : null]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      </View>
    );
  }

  return (
    <View accessibilityRole="radiogroup" style={styles.container}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ disabled, selected }}
            disabled={disabled}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected ? styles.selected : null, disabled ? styles.disabled : null]}
          >
            <Text style={[styles.label, selected ? styles.selectedLabel : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chevron: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20
  },
  container: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    padding: spacing.xs
  },
  dropdown: {
    gap: spacing.xs
  },
  disabled: {
    opacity: 0.55
  },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
    letterSpacing: 0
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    maxHeight: '76%',
    maxWidth: 520,
    padding: spacing.md,
    width: '100%'
  },
  modalScroll: {
    width: '100%'
  },
  radioInner: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 10,
    width: 10
  },
  radioLabelSelected: {
    color: colors.primary,
    fontWeight: '700'
  },
  radioList: {
    gap: spacing.xs
  },
  radioOption: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  radioOptionSelected: {
    backgroundColor: 'rgba(229, 199, 107, 0.12)',
    borderColor: 'rgba(229, 199, 107, 0.44)'
  },
  radioOuter: {
    alignItems: 'center',
    borderColor: colors.mutedSoft,
    borderRadius: 999,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22
  },
  radioOuterSelected: {
    borderColor: colors.primary
  },
  segment: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flexGrow: 1,
    minHeight: 44,
    minWidth: 104,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  selected: {
    backgroundColor: colors.primary
  },
  selectedLabel: {
    color: colors.primaryText
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  triggerLabel: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 20,
    minWidth: 0
  }
});
