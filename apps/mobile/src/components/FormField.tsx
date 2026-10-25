import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type NativeSyntheticEvent, type TextInputContentSizeChangeEventData, type TextInputProps } from 'react-native';

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
  help: _help,
  helpDisclosureLabel: _helpDisclosureLabel,
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
        placeholderTextColor={editable ? colors.placeholder : colors.disabled}
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
  multiline: {
    minHeight: 118
  }
});
