import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type NativeSyntheticEvent, type TextInputContentSizeChangeEventData, type TextInputProps } from 'react-native';

import { colors, radius, spacing, textStyles } from '@/constants/theme';

interface FormFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
  placeholder?: string;
  help?: string;
  helpDisclosureLabel?: string;
  multiline?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  autoComplete?: TextInputProps['autoComplete'];
  maxLength?: number;
  multilineMaxHeight?: number;
  multilineMinHeight?: number;
  returnKeyType?: TextInputProps['returnKeyType'];
  textContentType?: TextInputProps['textContentType'];
}

export function FormField({
  label,
  value,
  onChangeText,
  editable = true,
  placeholder,
  help,
  helpDisclosureLabel,
  multiline = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  autoCorrect = true,
  autoComplete,
  maxLength,
  multilineMaxHeight = 220,
  multilineMinHeight = 118,
  returnKeyType,
  textContentType
}: FormFieldProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const [contentHeight, setContentHeight] = useState(multilineMinHeight);
  // Help is presentation-only: keep the controlled input mounted and untouched.
  const [helpExpanded, setHelpExpanded] = useState(false);
  const multilineHeight = Math.min(multilineMaxHeight, Math.max(multilineMinHeight, contentHeight));
  const onContentSizeChange = (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>): void => {
    if (!multiline) {
      return;
    }
    setContentHeight(event.nativeEvent.contentSize.height + spacing.md);
  };

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {maxLength === undefined ? null : (
          <Text style={styles.counter}>{value.length}/{maxLength}</Text>
        )}
      </View>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        editable={editable}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onContentSizeChange={onContentSizeChange}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={colors.disabled}
        returnKeyType={returnKeyType ?? (multiline ? 'default' : 'done')}
        scrollEnabled={multiline}
        style={[
          styles.input,
          focused ? styles.inputFocused : null,
          multiline ? styles.multiline : null,
          multiline ? { height: multilineHeight, maxHeight: multilineMaxHeight } : null,
          editable ? null : styles.disabled
        ]}
        textAlignVertical={multiline ? 'top' : 'center'}
        textContentType={textContentType}
        value={value}
      />
      {help === undefined || helpDisclosureLabel === undefined ? null : (
        <Pressable
          accessibilityLabel={helpDisclosureLabel}
          accessibilityRole="button"
          accessibilityState={{ expanded: helpExpanded }}
          onPress={() => setHelpExpanded((current) => !current)}
          style={styles.helpDisclosure}
        >
          <Text style={styles.helpDisclosureLabel}>{helpDisclosureLabel}</Text>
          <Text accessible={false} style={styles.helpDisclosureLabel}>{helpExpanded ? '−' : '+'}</Text>
        </Pressable>
      )}
      {help === undefined || (helpDisclosureLabel !== undefined && !helpExpanded)
        ? null
        : <Text style={styles.help}>{help}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs
  },
  counter: {
    ...textStyles.caption,
    color: colors.muted
  },
  input: {
    backgroundColor: colors.controlSurface,
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  inputFocused: {
    backgroundColor: colors.controlSurfaceFocus,
    borderColor: colors.primary
  },
  disabled: {
    backgroundColor: colors.surfaceAlt,
    color: colors.mutedSoft,
    opacity: 0.82
  },
  label: {
    ...textStyles.caption,
    color: colors.ink,
    fontWeight: '700'
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between'
  },
  help: {
    ...textStyles.caption,
    color: colors.mutedSoft
  },
  helpDisclosure: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm
  },
  helpDisclosureLabel: {
    ...textStyles.caption,
    color: colors.primary,
    flexShrink: 1
  },
  multiline: {
    minHeight: 118
  }
});
