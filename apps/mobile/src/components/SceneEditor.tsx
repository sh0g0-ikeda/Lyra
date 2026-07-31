import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { SceneDraft } from '../domain/sceneDraft';
import { t, type UiLanguage } from '../lib/i18n';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';

interface SceneEditorProps {
  busy: boolean;
  dirty: boolean;
  draft: SceneDraft;
  errorMessage: string | null;
  language: UiLanguage;
  noticeMessage: string | null;
  onChangeAtmosphere(value: string): void;
  onChangeLocation(value: string): void;
  onChangeTime(value: string): void;
  onSave(): void;
}

export function SceneEditor({
  busy,
  dirty,
  draft,
  errorMessage,
  language,
  noticeMessage,
  onChangeAtmosphere,
  onChangeLocation,
  onChangeTime,
  onSave,
}: SceneEditorProps): React.JSX.Element {
  return (
    <View style={styles.editor}>
      <Text style={styles.label}>{t(language, 'sceneLocation')}</Text>
      <TextInput
        accessibilityLabel={t(language, 'sceneLocation')}
        editable={!busy}
        maxLength={201}
        onChangeText={onChangeLocation}
        style={styles.input}
        value={draft.location}
      />
      <Text style={styles.label}>{t(language, 'sceneTime')}</Text>
      <TextInput
        accessibilityLabel={t(language, 'sceneTime')}
        editable={!busy}
        maxLength={201}
        onChangeText={onChangeTime}
        style={styles.input}
        value={draft.time}
      />
      <Text style={styles.label}>{t(language, 'sceneAtmosphere')}</Text>
      <TextInput
        accessibilityLabel={t(language, 'sceneAtmosphere')}
        editable={!busy}
        maxLength={201}
        onChangeText={onChangeAtmosphere}
        style={styles.input}
        value={draft.atmosphere}
      />
      {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
      {noticeMessage === null ? null : <Notice message={noticeMessage} />}
      <PrimaryButton
        disabled={!dirty}
        label={t(language, 'sceneSave')}
        loading={busy}
        onPress={onSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 48,
    padding: spacing.sm,
  },
  label: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
});
