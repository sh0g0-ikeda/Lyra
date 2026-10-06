import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FormField } from '@/components/FormField';
import type { LabelOption } from '@/constants/options';
import { colors, spacing, textStyles } from '@/constants/theme';
import { t } from '@/lib/i18n';
import { editorMessage } from '@/lib/editorUiMessages';

interface CharacterChoiceFieldProps {
  label: string;
  value: string;
  options: LabelOption<string>[];
  language: 'ja' | 'en';
  maxLength?: number;
  searchable?: boolean;
  onChange: (value: string) => void;
}

export function CharacterChoiceField({
  label,
  value,
  options,
  language,
  maxLength = 100,
  searchable = false,
  onChange,
}: CharacterChoiceFieldProps): React.JSX.Element {
  const renderOptions = useMemo(
    () => (options.some((option) => option.value === 'custom') ? options : [...options, { value: 'custom', labelJa: '自由入力', labelEn: 'Custom' }]),
    [options]
  );
  const concreteOptionValues = useMemo(
    () => new Set(renderOptions.map((option) => option.value).filter((optionValue) => optionValue !== '' && optionValue !== 'custom')),
    [renderOptions]
  );
  const inferredValue = value === '' ? '' : concreteOptionValues.has(value) ? value : 'custom';
  const [emptyCustomSelected, setEmptyCustomSelected] = useState(false);
  const customMode = inferredValue === 'custom' || (value === '' && emptyCustomSelected);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const filteredOptions = !searchable || query.length === 0 ? renderOptions : renderOptions.filter(option => [option.value, option.labelJa, option.labelEn].some(label => label.toLocaleLowerCase().includes(query)));
  const selectedOption = renderOptions.find((option) => option.value === (customMode ? 'custom' : inferredValue));
  const selectedLabel = customMode && value.trim().length > 0
    ? value
    : selectedOption === undefined
      ? '-'
      : language === 'ja'
        ? selectedOption.labelJa
        : selectedOption.labelEn;

  const selectValue = (nextValue: string): void => {
    if (nextValue === 'custom') {
      setEmptyCustomSelected(true);
      onChange(concreteOptionValues.has(value) ? '' : value);
      setOptionsOpen(false);
      return;
    }

    setEmptyCustomSelected(false);
    onChange(nextValue);
    setOptionsOpen(false);
  };

  return (
    <View style={styles.choiceField}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={() => { setSearch(''); setOptionsOpen((current) => !current); }} style={styles.choiceTrigger}>
        <Text numberOfLines={1} style={styles.choiceValue}>{selectedLabel}</Text>
        <Text style={styles.choiceChevron}>{optionsOpen ? '^' : 'v'}</Text>
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setOptionsOpen(false)} transparent visible={optionsOpen}>
        <Pressable
          accessibilityLabel={t(language, "generated.screens.CharactersScreen.close.603bc62f")}
          accessibilityRole="button"
          onPress={() => setOptionsOpen(false)}
          style={styles.choiceModalBackdrop}
        >
          <View
            accessibilityLabel={label}
            accessibilityViewIsModal
            onAccessibilityEscape={() => setOptionsOpen(false)}
            onStartShouldSetResponder={() => true}
            style={styles.choiceModalSheet}
          >
            <View style={styles.choiceModalHeader}>
              <Text style={styles.groupTitle}>{label}</Text>
              <Pressable accessibilityLabel={t(language, "generated.screens.CharactersScreen.close.603bc62f")} accessibilityRole="button" onPress={() => setOptionsOpen(false)} style={styles.choiceModalClose}>
                <Text style={styles.choiceModalCloseText}>x</Text>
              </Pressable>
            </View>
            {searchable ? <FormField label={editorMessage(language, 'searchChoices')} value={search} onChangeText={setSearch} maxLength={100} /> : null}
            {filteredOptions.length === 0 ? <Text style={styles.label}>{editorMessage(language, 'noChoices')}</Text> : null}
            <ScrollView accessibilityRole="radiogroup" contentContainerStyle={styles.choiceMenu} style={styles.choiceModalScroll}>
              {filteredOptions.map((option) => {
                const selected = option.value === inferredValue || (customMode && option.value === 'custom');
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    key={option.value}
                    onPress={() => selectValue(option.value)}
                    style={[styles.choiceOption, selected ? styles.choiceOptionSelected : null]}
                  >
                    <View style={[styles.choiceRadioOuter, selected ? styles.choiceRadioOuterSelected : null]}>
                      {selected ? <View style={styles.choiceRadioInner} /> : null}
                    </View>
                    <Text style={[styles.choiceOptionText, selected ? styles.choiceOptionTextSelected : null]}>
                      {language === 'ja' ? option.labelJa : option.labelEn}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
      {customMode ? (
        <FormField
          label={t(language, "generated.screens.CharactersScreen.custom.value.75dadf38")}
          maxLength={maxLength}
          onChangeText={onChange}
          value={value}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  choiceChevron: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20
  },
  choiceField: {
    gap: spacing.xs
  },
  choiceMenu: {
    gap: spacing.xs
  },
  choiceModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md
  },
  choiceModalClose: {
    alignItems: 'center',
    backgroundColor: colors.field,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  choiceModalCloseText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20
  },
  choiceModalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between'
  },
  choiceModalScroll: {
    width: '100%'
  },
  choiceModalSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.controlBorder,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.md,
    maxHeight: '76%',
    maxWidth: 520,
    padding: spacing.md,
    width: '100%'
  },
  choiceOption: {
    alignItems: 'center',
    backgroundColor: colors.controlSurface,
    borderColor: colors.controlBorder,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  choiceOptionSelected: {
    backgroundColor: 'rgba(229, 199, 107, 0.12)',
    borderColor: 'rgba(229, 199, 107, 0.44)'
  },
  choiceOptionText: {
    ...textStyles.body,
    color: colors.ink,
    flex: 1,
    fontWeight: '600',
    minWidth: 0
  },
  choiceOptionTextSelected: {
    color: colors.primary,
    fontWeight: '700'
  },
  choiceRadioInner: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 10,
    width: 10
  },
  choiceRadioOuter: {
    alignItems: 'center',
    borderColor: colors.mutedSoft,
    borderRadius: 999,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22
  },
  choiceRadioOuterSelected: {
    borderColor: colors.primary
  },
  choiceTrigger: {
    alignItems: 'center',
    backgroundColor: colors.controlSurface,
    borderColor: colors.controlBorder,
    borderRadius: 6,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  choiceValue: {
    ...textStyles.body,
    flex: 1,
    minWidth: 0
  },
  groupTitle: {
    ...textStyles.body,
    flex: 1,
    minWidth: 0,
    color: colors.primary,
    fontWeight: '700'
  },
  label: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
});
