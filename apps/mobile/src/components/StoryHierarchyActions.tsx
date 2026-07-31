import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ChapterRecord, EpisodeRecord, WorkRecord } from '../lib/api';
import { t, type UiLanguage } from '../lib/i18n';
import { colors, radius, spacing } from '../constants/theme';
import { Notice } from './Notice';
import { PrimaryButton } from './PrimaryButton';

interface StoryHierarchyActionsProps {
  busy: boolean;
  canMoveChapterDown: boolean;
  canMoveChapterUp: boolean;
  canMoveEpisodeDown: boolean;
  canMoveEpisodeUp: boolean;
  errorMessage: string | null;
  language: UiLanguage;
  noticeMessage: string | null;
  onCreateChapter(title: string): Promise<boolean>;
  onCreateEpisode(title: string): Promise<boolean>;
  onCreateWork(title: string): Promise<boolean>;
  onMoveChapter(direction: 'up' | 'down'): Promise<boolean>;
  onMoveEpisode(direction: 'up' | 'down'): Promise<boolean>;
  onRenameChapter(title: string): Promise<boolean>;
  onRenameWork(title: string): Promise<boolean>;
  selectedChapter: ChapterRecord | null;
  selectedEpisode: EpisodeRecord | null;
  selectedWork: WorkRecord | null;
}

export function StoryHierarchyActions({
  busy,
  canMoveChapterDown,
  canMoveChapterUp,
  canMoveEpisodeDown,
  canMoveEpisodeUp,
  errorMessage,
  language,
  noticeMessage,
  onCreateChapter,
  onCreateEpisode,
  onCreateWork,
  onMoveChapter,
  onMoveEpisode,
  onRenameChapter,
  onRenameWork,
  selectedChapter,
  selectedEpisode,
  selectedWork,
}: StoryHierarchyActionsProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [newWorkTitle, setNewWorkTitle] = useState('');
  const [workTitleDraft, setWorkTitleDraft] = useState({
    id: selectedWork?.id ?? null,
    value: selectedWork?.title ?? '',
  });
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [chapterTitleDraft, setChapterTitleDraft] = useState({
    id: selectedChapter?.id ?? null,
    value: selectedChapter?.title ?? '',
  });
  const [newEpisodeTitle, setNewEpisodeTitle] = useState('');
  const workTitle = workTitleDraft.id === (selectedWork?.id ?? null)
    ? workTitleDraft.value
    : selectedWork?.title ?? '';
  const chapterTitle = chapterTitleDraft.id === (selectedChapter?.id ?? null)
    ? chapterTitleDraft.value
    : selectedChapter?.title ?? '';

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={t(language, 'storyHierarchyEdit')}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
      >
        <Text style={styles.toggleText}>{t(language, 'storyHierarchyEdit')}</Text>
        <Text style={styles.toggleText}>{expanded ? '−' : '+'}</Text>
      </Pressable>

      {!expanded ? null : (
        <View style={styles.content}>
          {errorMessage === null ? null : <Notice message={errorMessage} tone="danger" />}
          {noticeMessage === null ? null : <Notice message={noticeMessage} />}

          <ActionForm
            accessibilityLabel={t(language, 'storyNewWorkName')}
            busy={busy}
            buttonLabel={t(language, 'storyCreateWork')}
            onChange={setNewWorkTitle}
            onSubmit={async () => {
              if (await onCreateWork(newWorkTitle)) {
                setNewWorkTitle('');
              }
            }}
            value={newWorkTitle}
          />

          {selectedWork === null ? null : (
            <>
              <Text style={styles.sectionTitle}>{t(language, 'works')}</Text>
              <ActionForm
                accessibilityLabel={t(language, 'storyWorkName')}
                busy={busy}
                buttonLabel={t(language, 'storyRenameWork')}
                onChange={(value) => setWorkTitleDraft({
                  id: selectedWork.id,
                  value,
                })}
                onSubmit={() => onRenameWork(workTitle)}
                value={workTitle}
              />
              <ActionForm
                accessibilityLabel={t(language, 'storyNewChapterTitle')}
                busy={busy}
                buttonLabel={t(language, 'storyCreateChapter')}
                onChange={setNewChapterTitle}
                onSubmit={async () => {
                  if (await onCreateChapter(newChapterTitle)) {
                    setNewChapterTitle('');
                  }
                }}
                value={newChapterTitle}
              />
            </>
          )}

          {selectedChapter === null ? null : (
            <>
              <Text style={styles.sectionTitle}>{t(language, 'chapters')}</Text>
              <ActionForm
                accessibilityLabel={t(language, 'storyChapterTitle')}
                busy={busy}
                buttonLabel={t(language, 'storyRenameChapter')}
                onChange={(value) => setChapterTitleDraft({
                  id: selectedChapter.id,
                  value,
                })}
                onSubmit={() => onRenameChapter(chapterTitle)}
                value={chapterTitle}
              />
              <PrimaryButton
                disabled={busy || !canMoveChapterUp}
                label={t(language, 'storyMoveChapterUp')}
                onPress={() => void onMoveChapter('up')}
              />
              <PrimaryButton
                disabled={busy || !canMoveChapterDown}
                label={t(language, 'storyMoveChapterDown')}
                onPress={() => void onMoveChapter('down')}
              />
              <ActionForm
                accessibilityLabel={t(language, 'storyNewEpisodeTitle')}
                busy={busy}
                buttonLabel={t(language, 'storyCreateEpisode')}
                onChange={setNewEpisodeTitle}
                onSubmit={async () => {
                  if (await onCreateEpisode(newEpisodeTitle)) {
                    setNewEpisodeTitle('');
                  }
                }}
                value={newEpisodeTitle}
              />
            </>
          )}

          {selectedEpisode === null ? null : (
            <>
              <Text style={styles.sectionTitle}>{t(language, 'episodes')}</Text>
              <PrimaryButton
                disabled={busy || !canMoveEpisodeUp}
                label={t(language, 'storyMoveEpisodeUp')}
                onPress={() => void onMoveEpisode('up')}
              />
              <PrimaryButton
                disabled={busy || !canMoveEpisodeDown}
                label={t(language, 'storyMoveEpisodeDown')}
                onPress={() => void onMoveEpisode('down')}
              />
            </>
          )}
        </View>
      )}
    </View>
  );
}

interface ActionFormProps {
  accessibilityLabel: string;
  busy: boolean;
  buttonLabel: string;
  onChange(value: string): void;
  onSubmit(): Promise<boolean> | Promise<void>;
  value: string;
}

function ActionForm({
  accessibilityLabel,
  busy,
  buttonLabel,
  onChange,
  onSubmit,
  value,
}: ActionFormProps): React.JSX.Element {
  return (
    <View style={styles.form}>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        editable={!busy}
        maxLength={200}
        onChangeText={onChange}
        placeholder={accessibilityLabel}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={value}
      />
      <PrimaryButton
        disabled={busy}
        label={buttonLabel}
        onPress={() => void onSubmit()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  content: {
    gap: spacing.sm,
    padding: spacing.sm,
  },
  form: {
    gap: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  pressed: {
    opacity: 0.75,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  toggle: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  toggleText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '700',
  },
});
