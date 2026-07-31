import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '../constants/theme';
import type { EpisodeStoryDraft } from '../domain/episodeStoryDraft';
import { t, type UiLanguage } from '../lib/i18n';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';

interface StoryEditorProps {
  dirty: boolean;
  draft: EpisodeStoryDraft;
  errorMessage: string | null;
  language: UiLanguage;
  noticeMessage: string | null;
  onChangeEstimatedPages(value: string): void;
  onChangeStory(value: string): void;
  onChangeTitle(value: string): void;
  onSave(): void;
  saving: boolean;
}

export function StoryEditor({
  dirty,
  draft,
  errorMessage,
  language,
  noticeMessage,
  onChangeEstimatedPages,
  onChangeStory,
  onChangeTitle,
  onSave,
  saving,
}: StoryEditorProps): React.JSX.Element {
  return (
    <View style={styles.editor}>
      <Text style={styles.label}>{t(language, 'storyTitle')}</Text>
      <TextInput
        accessibilityLabel={t(language, 'storyTitle')}
        maxLength={201}
        onChangeText={onChangeTitle}
        style={styles.input}
        value={draft.title}
      />
      <Text style={styles.label}>{t(language, 'storyBody')}</Text>
      <TextInput
        accessibilityLabel={t(language, 'storyBody')}
        maxLength={8_001}
        multiline
        onChangeText={onChangeStory}
        style={[styles.input, styles.storyInput]}
        textAlignVertical="top"
        value={draft.story}
      />
      <Text style={styles.label}>{t(language, 'storyEstimatedPages')}</Text>
      <TextInput
        accessibilityLabel={t(language, 'storyEstimatedPages')}
        inputMode="numeric"
        maxLength={2}
        onChangeText={onChangeEstimatedPages}
        style={styles.input}
        value={draft.estimatedPages}
      />
      {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
      {noticeMessage === null ? null : <Notice message={noticeMessage} />}
      <PrimaryButton
        disabled={!dirty}
        label={t(language, 'save')}
        loading={saving}
        onPress={onSave}
      />
      <View style={styles.storyAiNotice}>
        <Text style={styles.subheading}>Story AI</Text>
        <Text style={styles.muted}>{t(language, 'storyAiUnavailable')}</Text>
      </View>
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
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  storyAiNotice: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  storyInput: {
    minHeight: 220,
  },
  subheading: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
  },
});
