import { useState } from 'react';
import { BookOpen, ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionableErrorNotice } from '@/components/ActionableErrorNotice';
import { StoryHierarchySheet } from '@/components/StoryHierarchySheet';
import type { WorkspaceContextData } from '@/components/WorkspaceContextPicker';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { t } from '@/lib/i18n';
import { navigationRef } from '@/navigation/navigationRef';
import { useAppState } from '@/state/appState';
import { useDirtyState } from '@/state/dirtyState';

interface WorkspaceHierarchyNavigatorProps {
  context: WorkspaceContextData;
}

export function WorkspaceHierarchyNavigator({
  context
}: WorkspaceHierarchyNavigatorProps): React.JSX.Element {
  const {
    api,
    hasCapability,
    language,
    logout,
    selection,
    session,
    sessionKey,
    updateSelection
  } = useAppState();
  const { resolveDirtyEditors } = useDirtyState();
  const [visible, setVisible] = useState(false);
  const work =
    context.works.find((candidate) => candidate.id === context.selectedWorkId) ??
    null;
  const chapter =
    context.chapters.find(
      (candidate) => candidate.id === context.selectedChapterId
    ) ?? null;
  const episode =
    context.episodes.find(
      (candidate) => candidate.id === context.selectedEpisodeId
    ) ?? null;
  const currentPath =
    work === null || chapter === null || episode === null
      ? t(language, 'component.workspaceHierarchy.selectEpisode')
      : `${work.title} / ${
          chapter.title?.trim() ||
          t(language, 'component.storyHierarchySheet.chapterFallbackTitle', {
            order: chapter.order
          })
        } / ${
          episode.title?.trim() ||
          t(language, 'component.storyHierarchySheet.episodeFallbackTitle', {
            order: episode.order
          })
        }`;

  const selectEpisode = (
    workId: string,
    chapterId: string,
    episodeId: string
  ): void => {
    void updateSelection({
      workId,
      chapterId,
      episodeId,
      pageId: null,
      entityId: null
    }).then((changed) => {
      if (changed) {
        setVisible(false);
      }
    });
  };

  return (
    <>
      <Pressable
        accessibilityLabel={t(language, 'component.workspaceHierarchy.open')}
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.trigger,
          pressed ? styles.triggerPressed : null
        ]}
      >
        <View style={styles.icon}>
          <BookOpen color={colors.primary} size={21} strokeWidth={2.1} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>
            {t(language, 'component.workspaceHierarchy.title')}
          </Text>
          <Text numberOfLines={1} style={styles.current}>
            {currentPath}
          </Text>
        </View>
        <ChevronRight color={colors.primary} size={22} strokeWidth={2.2} />
      </Pressable>
      {context.error === null ? null : (
        <ActionableErrorNotice
          actions={{
            login: () => {
              void logout();
            },
            retry: context.retry,
            workspace: () => {
              void resolveDirtyEditors(language).then((canLeave) => {
                if (canLeave && navigationRef.isReady()) {
                  navigationRef.navigate('Account');
                }
              });
            }
          }}
          error={context.error}
          language={language}
        />
      )}
      <StoryHierarchySheet
        api={api}
        canCreateWork={hasCapability('create_work')}
        canEdit={hasCapability('edit_work')}
        hasNextWorks={context.hasMoreWorks}
        isFetchingNextWorks={context.isFetchingMoreWorks}
        language={language}
        onChapterDeleted={(chapterId) => {
          if (selection.chapterId === chapterId) {
            void updateSelection(
              { chapterId: null, episodeId: null, pageId: null },
              { skipDirtyCheck: true }
            );
          }
        }}
        onChapterRenamed={() => undefined}
        onClose={() => setVisible(false)}
        onEndReachedWorks={context.loadMoreWorks}
        onEpisodeDeleted={(episodeId) => {
          if (selection.episodeId === episodeId) {
            void updateSelection(
              { episodeId: null, pageId: null },
              { skipDirtyCheck: true }
            );
          }
        }}
        onEpisodeRenamed={() => undefined}
        onSelectChapter={(workId, chapterId) => {
          void updateSelection({
            workId,
            chapterId,
            episodeId: null,
            pageId: null,
            entityId: null
          });
        }}
        onSelectEpisode={selectEpisode}
        onSelectWork={(workId) => {
          void updateSelection({
            workId,
            chapterId: null,
            episodeId: null,
            pageId: null,
            entityId: null
          });
        }}
        onWorkRenamed={() => undefined}
        organizationId={selection.organizationId}
        selectedChapterId={context.selectedChapterId}
        selectedEpisodeId={context.selectedEpisodeId}
        selectedWorkId={context.selectedWorkId}
        sessionKey={sessionKey}
        userId={session?.user.id ?? sessionKey}
        visible={visible}
        works={context.works}
      />
    </>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    gap: 2,
    minWidth: 0
  },
  current: {
    ...textStyles.caption,
    color: colors.ink
  },
  icon: {
    alignItems: 'center',
    backgroundColor: 'rgba(229, 199, 107, 0.12)',
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  title: {
    ...textStyles.body,
    color: colors.inkStrong,
    fontWeight: '700'
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.controlSurface,
    borderColor: colors.controlBorder,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  triggerPressed: {
    backgroundColor: colors.controlSurfaceFocus,
    borderColor: colors.primary
  }
});
