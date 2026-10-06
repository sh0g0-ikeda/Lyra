import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import { MangaTutorial } from '@/components/MangaTutorial';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { StoryHierarchySheet } from '@/components/StoryHierarchySheet';
import type { WorkspaceContextData } from '@/components/WorkspaceContextPicker';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import type { MangaCreationStep } from '@/domain/mangaWorkflow';
import { t } from '@/lib/i18n';
import { useAppState } from '@/state/appState';

interface MangaLibraryProps {
  context: WorkspaceContextData;
  onResume: () => void;
  onStartStory?: () => void;
  onOpenGuide: () => void;
  resumeStep: MangaCreationStep;
  loadingProgress: boolean;
  progressError: unknown;
  onRetryProgress: () => void;
}

// Reuse the established hierarchy CRUD and its authorization/dirty selection path.
// The library only chooses context; opening a work never generates or saves it.
export function MangaLibrary({
  context, onResume, onStartStory, onOpenGuide, resumeStep, loadingProgress, progressError, onRetryProgress
}: MangaLibraryProps): React.JSX.Element {
  const { api, hasCapability, language, logout, selection, session, sessionKey, updateSelection } = useAppState();
  const [showHierarchy, setShowHierarchy] = useState(false);
  const episode = context.episodes.find((item) => item.id === context.selectedEpisodeId);
  const work = context.works.find((item) => item.id === context.selectedWorkId);
  const chapter = context.chapters.find((item) => item.id === context.selectedChapterId);
  const selectWork = async (workId: string): Promise<void> => {
    if (workId === selection.workId || await updateSelection({ workId, chapterId: null, episodeId: null, pageId: null, entityId: null })) {
      setShowHierarchy(true);
    }
  };

  return (
    <Screen title={t(language, 'navigation.library')} subtitle={t(language, 'navigation.libraryHelp')} testID="manga-library">
      {context.error === null ? null : (
        <ActionableErrorNotice context={{ operation: 'loadHierarchy' }} retryMode="refresh" error={context.error} language={language} actions={{ retry: context.retry, login: () => void logout() }} />
      )}
      <PrimaryButton
        label={t(language, hasCapability('create_work') ? 'navigation.createManga' : 'navigation.chooseWork')}
        onPress={() => setShowHierarchy(true)}
        testID="manga-create"
      />
      {onStartStory === undefined ? null : <PrimaryButton label={t(language, 'navigation.openStory')} onPress={onStartStory} variant="secondary" testID="manga-start-story" />}
      <MangaTutorial firstRun />
      {context.works.length === 0 && context.error === null ? <Text style={styles.help}>{t(language, 'emptyWorks')}</Text> : null}
      {context.works.map((item) => (
        <Pressable
          accessibilityLabel={t(language, 'navigation.openWork', { title: item.title })}
          accessibilityRole="button"
          accessibilityState={{ selected: item.id === context.selectedWorkId }}
          key={item.id}
          onPress={() => void selectWork(item.id)}
          style={[styles.work, item.id === context.selectedWorkId ? styles.selectedWork : null]}
          testID={`manga-work-${item.id}`}
        >
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.help}>{t(language, 'navigation.chooseWork')}</Text>
        </Pressable>
      ))}
      {context.hasMoreWorks ? (
        <PrimaryButton label={t(language, 'navigation.moreWorks')} onPress={context.loadMoreWorks} loading={context.isFetchingMoreWorks} variant="secondary" />
      ) : null}
      {episode === undefined ? null : (
        <View style={styles.resume}>
          <Text style={styles.title}>{work?.title} / {chapter?.title ?? t(language, 'chapter')} / {episode.title ?? t(language, 'episode')}</Text>
          <Text style={styles.help}>{t(language, 'navigation.resumeAt', { step: t(language, resumeStep) })}</Text>
          {progressError === null ? null : (
            <ActionableErrorNotice context={{ operation: 'loadProgress' }} retryMode="refresh" error={progressError} language={language} actions={{ retry: onRetryProgress, login: () => void logout() }} />
          )}
          <PrimaryButton
            label={t(language, 'navigation.resume')}
            disabled={loadingProgress}
            disabledReason={loadingProgress ? t(language, 'navigation.loadingResume') : undefined}
            onPress={onResume}
            testID="manga-resume"
          />
        </View>
      )}
      <PrimaryButton label={t(language, 'navigation.guide')} onPress={onOpenGuide} variant="secondary" testID="manga-guide" />
      <StoryHierarchySheet
        api={api}
        canCreateWork={hasCapability('create_work')}
        canEdit={hasCapability('edit_work')}
        hasNextWorks={context.hasMoreWorks}
        isFetchingNextWorks={context.isFetchingMoreWorks}
        language={language}
        onChapterDeleted={(chapterId) => {
          if (selection.chapterId === chapterId) void updateSelection({ chapterId: null, episodeId: null, pageId: null }, { skipDirtyCheck: true });
        }}
        onChapterRenamed={() => undefined}
        onClose={() => setShowHierarchy(false)}
        onEndReachedWorks={context.loadMoreWorks}
        onEpisodeDeleted={(episodeId) => {
          if (selection.episodeId === episodeId) void updateSelection({ episodeId: null, pageId: null }, { skipDirtyCheck: true });
        }}
        onEpisodeRenamed={() => undefined}
        onSelectChapter={(workId, chapterId) => { void updateSelection({ workId, chapterId, episodeId: null, pageId: null, entityId: null }); }}
        onSelectEpisode={(workId, chapterId, episodeId) => {
          void updateSelection({ workId, chapterId, episodeId, pageId: null, entityId: null }).then((allowed) => {
            if (allowed) setShowHierarchy(false);
          });
        }}
        onSelectWork={(workId) => { void updateSelection({ workId, chapterId: null, episodeId: null, pageId: null, entityId: null }); }}
        onWorkRenamed={() => undefined}
        organizationId={selection.organizationId}
        selectedChapterId={context.selectedChapterId}
        selectedEpisodeId={context.selectedEpisodeId}
        selectedWorkId={context.selectedWorkId}
        sessionKey={sessionKey}
        userId={session?.user.id ?? sessionKey}
        visible={showHierarchy}
        works={context.works}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  help: { ...textStyles.body, color: colors.muted },
  resume: { gap: spacing.sm, paddingVertical: spacing.md },
  selectedWork: { borderColor: colors.primary },
  title: { ...textStyles.sectionTitle },
  work: { borderColor: colors.controlBorder, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, backgroundColor: colors.surface }
});
