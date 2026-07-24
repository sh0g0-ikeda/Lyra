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
        onChangeText={onChangeText}
        onContentSizeChange={onContentSizeChange}
        placeholder={placeholder}
        placeholderTextColor={colors.disabled}
        returnKeyType={returnKeyType ?? (multiline ? 'default' : 'done')}
        scrollEnabled={multiline}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          multiline ? { height: multilineHeight, maxHeight: multilineMaxHeight } : null,
          editable ? null : styles.disabled
        ]}
        textAlignVertical={multiline ? 'top' : 'center'}
        textContentType={textContentType}
        value={value}
      />
      {help === undefined ? null : <Text style={styles.help}>{help}</Text>}
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
    backgroundColor: colors.field,
    borderColor: 'rgba(229, 199, 107, 0.22)',
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
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
  multiline: {
    minHeight: 118
  }
});
