import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, textStyles } from '@/constants/theme';
import type { EpisodeStateAutofillChoice } from '@/domain/episodeStateAutofillPolicy';
import type { UiLanguage } from '@/domain/types';
import { episodeStateMessage as message } from '@/lib/episodeStateMessages';

interface StoryStateAutofillOptionsProps {
  available: boolean;
  disabled: boolean;
  language: UiLanguage;
  value: EpisodeStateAutofillChoice;
  onChange: (value: EpisodeStateAutofillChoice) => void;
}

export function StoryStateAutofillOptions({ available, disabled, language, value, onChange }: StoryStateAutofillOptionsProps): React.JSX.Element | null {
  if (!available) return null;
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{message(language, 'autofillTitle')}</Text>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value.enabled, disabled }} disabled={disabled} onPress={() => onChange({ enabled: !value.enabled, overwrite: false })} style={styles.option} testID="state-autofill-enable">
        <Text style={styles.optionText}>{value.enabled ? '☑ ' : '☐ '}{message(language, 'autofillEnabled')}</Text>
      </Pressable>
      {value.enabled ? (
        <>
          <Text style={styles.help}>{message(language, 'autofillHelp')}</Text>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value.overwrite, disabled }} disabled={disabled} onPress={() => onChange({ ...value, overwrite: !value.overwrite })} style={styles.option} testID="state-autofill-overwrite">
            <Text style={styles.optionText}>{value.overwrite ? '☑ ' : '☐ '}{message(language, 'overwrite')}</Text>
          </Pressable>
          <Text style={value.overwrite ? styles.warning : styles.help}>{message(language, value.overwrite ? 'overwriteWarning' : 'preserveHelp')}</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  help: { ...textStyles.body, color: colors.muted },
  option: { minHeight: 44, justifyContent: 'center', paddingVertical: spacing.sm },
  optionText: { ...textStyles.body, color: colors.inkStrong },
  root: { gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...textStyles.sectionTitle },
  warning: { ...textStyles.body, color: colors.warning }
});
