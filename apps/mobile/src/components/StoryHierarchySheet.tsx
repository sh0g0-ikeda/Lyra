import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X
} from 'lucide-react-native';

import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import {
  buildNewChapterPayload,
  buildNewEpisodePayload,
  canMoveEpisodeInHierarchy
} from '@/domain/storyHierarchyPolicy';
import type {
  ChapterRecord,
  EpisodeRecord,
  UiLanguage,
  WorkRecord
} from '@/domain/types';
import { ApiError, type LyraMobileApiClient } from '@/lib/api';
import { confirmDestructiveAction } from '@/lib/confirm';
import { t } from '@/lib/i18n';
import {
  chaptersQueryKey,
  episodesQueryKey,
  workDetailQueryKey,
  worksQueryKey
} from '@/lib/queryKeys';
import {
  loadStoryHierarchyExpansion,
  saveStoryHierarchyExpansion
} from '@/lib/storage';
import { userErrorMessage } from '@/lib/userMessages';

type StoryHierarchyApi = Pick<
  LyraMobileApiClient,
  | 'createChapter'
  | 'createEpisode'
  | 'createWork'
  | 'deleteChapter'
  | 'deleteEpisode'
   | 'getChapters'
   | 'getEpisodes'
   | 'getWork'
  | 'moveChapter'
  | 'moveEpisode'
  | 'updateChapter'
  | 'updateEpisode'
  | 'updateWork'
>;

interface StoryHierarchySheetProps {
  api: StoryHierarchyApi;
  visible: boolean;
  works: WorkRecord[];
  hasNextWorks?: boolean;
  isFetchingNextWorks?: boolean;
  onEndReachedWorks?: () => void;
  selectedWorkId: string | null;
  selectedChapterId: string | null;
  selectedEpisodeId: string | null;
  sessionKey: string;
  userId: string;
  organizationId: string | null;
  language: UiLanguage;
  canCreateWork: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onSelectEpisode: (workId: string, chapterId: string, episodeId: string) => void;
  onChapterDeleted: (chapterId: string) => void;
  onEpisodeDeleted: (episodeId: string) => void;
  onWorkRenamed: (workId: string, title: string) => void;
  onChapterRenamed: (chapterId: string, title: string) => void;
  onEpisodeRenamed: (episodeId: string, title: string) => void;
}

type MenuTarget =
  | {
      kind: 'work';
      work: WorkRecord;
    }
  | {
      kind: 'chapter';
      work: WorkRecord;
      chapter: ChapterRecord;
      chapterIndex: number;
      chapterCount: number;
    }
  | {
      kind: 'episode';
      work: WorkRecord;
      chapter: ChapterRecord;
      episode: EpisodeRecord;
      chapterIndex: number;
      chapterCount: number;
      episodeIndex: number;
      episodeCount: number;
    };

type TitleIntent =
  | { kind: 'create-work' }
  | { kind: 'rename-work'; work: WorkRecord }
  | { kind: 'create-chapter'; work: WorkRecord }
  | { kind: 'rename-chapter'; work: WorkRecord; chapter: ChapterRecord }
  | { kind: 'create-episode'; work: WorkRecord; chapter: ChapterRecord }
  | { kind: 'rename-episode'; work: WorkRecord; chapter: ChapterRecord; episode: EpisodeRecord };

interface WorkNodeProps {
  api: StoryHierarchyApi;
  work: WorkRecord;
  workIndex: number;
  visible: boolean;
  expanded: boolean;
  selectedWorkId: string | null;
  selectedChapterId: string | null;
  selectedEpisodeId: string | null;
  sessionKey: string;
  organizationId: string | null;
  language: UiLanguage;
  canEdit: boolean;
  pending: boolean;
  expandedChapterIds: Set<string>;
  onToggleWork: (workId: string) => void;
  onToggleChapter: (chapterId: string) => void;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onSelectEpisode: (workId: string, chapterId: string, episodeId: string) => void;
  onAddChapter: (work: WorkRecord) => void;
  onAddEpisode: (work: WorkRecord, chapter: ChapterRecord) => void;
  onOpenMenu: (target: MenuTarget) => void;
}

interface ChapterNodeProps {
  api: StoryHierarchyApi;
  work: WorkRecord;
  chapter: ChapterRecord;
  chapterIndex: number;
  chapterCount: number;
  visible: boolean;
  expanded: boolean;
  selectedChapterId: string | null;
  selectedEpisodeId: string | null;
  sessionKey: string;
  organizationId: string | null;
  language: UiLanguage;
  canEdit: boolean;
  pending: boolean;
  onToggle: () => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onSelectEpisode: (workId: string, chapterId: string, episodeId: string) => void;
  onAddEpisode: (work: WorkRecord, chapter: ChapterRecord) => void;
  onOpenMenu: (target: MenuTarget) => void;
}

interface TreeRowProps {
  depth: 0 | 1 | 2;
  title: string;
  selected: boolean;
  canEdit: boolean;
  expanded?: boolean;
  kind: 'work' | 'chapter' | 'episode';
  language: UiLanguage;
  onToggle?: () => void;
  onSelect: () => void;
  onMenu: () => void;
}

interface TreeCreateActionProps {
  accessibilityLabel: string;
  actionTestID: string;
  depth: 1 | 2;
  disabled: boolean;
  label: string;
  onPress: () => void;
}

const sortedByOrder = <T extends { order: number }>(records: readonly T[]): T[] =>
  [...records].sort((left, right) => left.order - right.order);

const titleForChapter = (chapter: ChapterRecord, language: UiLanguage): string =>
  chapter.title?.trim() || t(language, 'component.storyHierarchySheet.chapterFallbackTitle', { order: chapter.order });

const titleForEpisode = (episode: EpisodeRecord, language: UiLanguage): string =>
  episode.title?.trim() || t(language, 'component.storyHierarchySheet.episodeFallbackTitle', { order: episode.order });

function TreeRow({
  depth,
  title,
  selected,
  canEdit,
  expanded,
  kind,
  language,
  onToggle,
  onSelect,
  onMenu
}: TreeRowProps): React.JSX.Element {
  const toggleLabel = expanded
    ? t(language, 'component.storyHierarchySheet.collapse', { title })
    : t(language, 'component.storyHierarchySheet.expand', { title });
  const Icon = kind === 'work' ? BookOpen : kind === 'chapter' ? (expanded ? FolderOpen : Folder) : FileText;

  return (
    <View
      style={[
        styles.treeRow,
        depth === 1 ? styles.depthOne : null,
        depth === 2 ? styles.depthTwo : null,
        selected ? styles.treeRowSelected : null
      ]}
    >
      {onToggle === undefined ? (
        <View style={styles.chevronSpacer} />
      ) : (
        <Pressable
          accessibilityLabel={toggleLabel}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={4}
          onPress={onToggle}
          style={styles.iconButton}
        >
          {expanded
            ? <ChevronDown color={colors.primary} size={19} strokeWidth={2} />
            : <ChevronRight color={colors.muted} size={19} strokeWidth={2} />}
        </Pressable>
      )}
      <Pressable
        accessibilityLabel={t(language, 'component.storyHierarchySheet.select', { title })}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onSelect}
        style={styles.treeTitleButton}
      >
        <Icon color={selected ? colors.primary : colors.muted} size={19} strokeWidth={2} />
        <Text numberOfLines={1} style={[styles.treeTitle, selected ? styles.treeTitleSelected : null]}>
          {title}
        </Text>
      </Pressable>
      {canEdit ? (
        <Pressable
          accessibilityLabel={t(language, 'component.storyHierarchySheet.actions', { title })}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onMenu}
          style={styles.iconButton}
        >
          <MoreHorizontal color={colors.ink} size={21} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

function TreeCreateAction({
  accessibilityLabel,
  actionTestID,
  depth,
  disabled,
  label,
  onPress
}: TreeCreateActionProps): React.JSX.Element {
  return (
    <View style={depth === 1 ? styles.depthOneCreateAction : styles.depthTwoCreateAction}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={styles.createActionButton}
        testID={actionTestID}
      >
        <Plus color={colors.primary} size={18} strokeWidth={2.2} />
        <Text style={styles.createActionLabel}>{label}</Text>
      </Pressable>
    </View>
  );
}

function ChapterNode({
  api,
  work,
  chapter,
  chapterIndex,
  chapterCount,
  visible,
  expanded,
  selectedChapterId,
  selectedEpisodeId,
  sessionKey,
  organizationId,
  language,
  canEdit,
  pending,
  onToggle,
  onSelectChapter,
  onSelectEpisode,
  onAddEpisode,
  onOpenMenu
}: ChapterNodeProps): React.JSX.Element {
  const episodesQuery = useQuery({
    enabled: visible && expanded,
    queryKey: episodesQueryKey(sessionKey, chapter.id, organizationId),
    queryFn: () => api.getEpisodes(chapter.id, organizationId)
  });
  const episodes = sortedByOrder(episodesQuery.data?.episodes ?? []);
  const title = titleForChapter(chapter, language);

  return (
    <View style={styles.branch}>
      <TreeRow
        canEdit={canEdit}
        depth={1}
        expanded={expanded}
        kind="chapter"
        language={language}
        onMenu={() => onOpenMenu({ kind: 'chapter', work, chapter, chapterIndex, chapterCount })}
        onSelect={() => onSelectChapter(work.id, chapter.id)}
        onToggle={onToggle}
        selected={selectedChapterId === chapter.id}
        title={`${chapter.order}. ${title}`}
      />
      {!expanded ? null : (
        <View style={styles.childBranch}>
          {episodesQuery.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.loadingLabel}>{t(language, "generated.components.StoryHierarchySheet.loading.episodes.e4ed2ecc")}</Text>
            </View>
          ) : null}
          {canEdit ? (
            <TreeCreateAction
              accessibilityLabel={t(language, 'component.storyHierarchySheet.addEpisodeTo', { title })}
              actionTestID={`story-hierarchy-add-episode-${chapter.id}`}
              depth={2}
              disabled={pending}
              label={t(language, "generated.components.StoryHierarchySheet.add.episode.ad67475b")}
              onPress={() => onAddEpisode(work, chapter)}
            />
          ) : null}
          {episodes.map((episode, episodeIndex) => {
            const episodeTitle = titleForEpisode(episode, language);
            return (
              <TreeRow
                canEdit={canEdit}
                depth={2}
                key={episode.id}
                kind="episode"
                language={language}
                onMenu={() => onOpenMenu({
                  kind: 'episode',
                  work,
                  chapter,
                  episode,
                  chapterIndex,
                  chapterCount,
                  episodeIndex,
                  episodeCount: episodes.length
                })}
                onSelect={() => onSelectEpisode(work.id, chapter.id, episode.id)}
                selected={selectedEpisodeId === episode.id}
                title={`${episode.order}. ${episodeTitle}`}
              />
            );
          })}
          {!episodesQuery.isLoading && episodes.length === 0 ? (
            <Text style={styles.emptyBranch}>{t(language, "generated.components.StoryHierarchySheet.no.episodes.yet.7abbd110")}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

function WorkNode({
  api,
  work,
  visible,
  expanded,
  selectedWorkId,
  selectedChapterId,
  selectedEpisodeId,
  sessionKey,
  organizationId,
  language,
  canEdit,
  pending,
  expandedChapterIds,
  onToggleWork,
  onToggleChapter,
  onSelectWork,
  onSelectChapter,
  onSelectEpisode,
  onAddChapter,
  onAddEpisode,
  onOpenMenu
}: WorkNodeProps): React.JSX.Element {
  const chaptersQuery = useQuery({
    enabled: visible && expanded,
    queryKey: chaptersQueryKey(sessionKey, work.id, organizationId),
    queryFn: () => api.getChapters(work.id, organizationId)
  });
  const chapters = sortedByOrder(chaptersQuery.data?.chapters ?? []);

  return (
    <View style={styles.branch}>
      <TreeRow
        canEdit={canEdit}
        depth={0}
        expanded={expanded}
        kind="work"
        language={language}
        onMenu={() => onOpenMenu({ kind: 'work', work })}
        onSelect={() => onSelectWork(work.id)}
        onToggle={() => onToggleWork(work.id)}
        selected={selectedWorkId === work.id}
        title={work.title}
      />
      {!expanded ? null : (
        <View style={styles.childBranch}>
          {chaptersQuery.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.loadingLabel}>{t(language, "generated.components.StoryHierarchySheet.loading.chapters.62730c70")}</Text>
            </View>
          ) : null}
          {canEdit ? (
            <TreeCreateAction
              accessibilityLabel={t(language, 'component.storyHierarchySheet.addChapterTo', { title: work.title })}
              actionTestID={`story-hierarchy-add-chapter-${work.id}`}
              depth={1}
              disabled={pending}
              label={t(language, "generated.components.StoryHierarchySheet.add.chapter.774ad8c0")}
              onPress={() => onAddChapter(work)}
            />
          ) : null}
          {chapters.map((chapter, chapterIndex) => (
            <ChapterNode
              api={api}
              canEdit={canEdit}
              chapter={chapter}
              chapterCount={chapters.length}
              chapterIndex={chapterIndex}
              expanded={expandedChapterIds.has(chapter.id)}
              key={chapter.id}
              language={language}
              onAddEpisode={onAddEpisode}
              onOpenMenu={onOpenMenu}
              onSelectChapter={onSelectChapter}
              onSelectEpisode={onSelectEpisode}
              onToggle={() => onToggleChapter(chapter.id)}
              organizationId={organizationId}
              pending={pending}
              selectedChapterId={selectedChapterId}
              selectedEpisodeId={selectedEpisodeId}
              sessionKey={sessionKey}
              visible={visible}
              work={work}
            />
          ))}
          {!chaptersQuery.isLoading && chapters.length === 0 ? (
            <Text style={styles.emptyBranch}>{t(language, "generated.components.StoryHierarchySheet.no.chapters.yet.4d8608eb")}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

export function StoryHierarchySheet({
  api,
  visible,
  works,
  hasNextWorks = false,
  isFetchingNextWorks = false,
  onEndReachedWorks,
  selectedWorkId,
  selectedChapterId,
  selectedEpisodeId,
  sessionKey,
  userId,
  organizationId,
  language,
  canCreateWork,
  canEdit,
  onClose,
  onSelectWork,
  onSelectChapter,
  onSelectEpisode,
  onChapterDeleted,
  onEpisodeDeleted,
  onWorkRenamed,
  onChapterRenamed,
  onEpisodeRenamed
}: StoryHierarchySheetProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const safeAreaInsets = useSafeAreaInsets();
  const expansionScope = `${userId}:${organizationId ?? 'personal'}`;
  const [expandedWorkIds, setExpandedWorkIds] = useState<Set<string>>(new Set());
  const [expandedChapterIds, setExpandedChapterIds] = useState<Set<string>>(new Set());
  const [loadedExpansionScope, setLoadedExpansionScope] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [titleIntent, setTitleIntent] = useState<TitleIntent | null>(null);
  const [titleValue, setTitleValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    void loadStoryHierarchyExpansion(userId, organizationId).then((stored) => {
      if (!active) {
        return;
      }
      setExpandedWorkIds(new Set(stored.workIds));
      setExpandedChapterIds(new Set(stored.chapterIds));
      setLoadedExpansionScope(expansionScope);
    });
    return () => {
      active = false;
    };
  }, [expansionScope, organizationId, userId]);

  const effectiveExpandedWorkIds = useMemo(() => {
    const liveWorkIds = new Set(works.map((work) => work.id));
    const storedIds = loadedExpansionScope === expansionScope ? expandedWorkIds : new Set<string>();
    const result = new Set([...storedIds].filter((id) => liveWorkIds.has(id)));
    if (selectedWorkId !== null && liveWorkIds.has(selectedWorkId)) {
      result.add(selectedWorkId);
    }
    return result;
  }, [expandedWorkIds, expansionScope, loadedExpansionScope, selectedWorkId, works]);

  const effectiveExpandedChapterIds = useMemo(() => {
    const storedIds = loadedExpansionScope === expansionScope ? expandedChapterIds : new Set<string>();
    const result = new Set(storedIds);
    if (selectedChapterId !== null) {
      result.add(selectedChapterId);
    }
    return result;
  }, [expandedChapterIds, expansionScope, loadedExpansionScope, selectedChapterId]);

  useEffect(() => {
    if (loadedExpansionScope !== expansionScope) {
      return;
    }
    void saveStoryHierarchyExpansion(userId, organizationId, {
      workIds: [...effectiveExpandedWorkIds],
      chapterIds: [...effectiveExpandedChapterIds]
    });
  }, [
    effectiveExpandedChapterIds,
    effectiveExpandedWorkIds,
    expansionScope,
    loadedExpansionScope,
    organizationId,
    userId
  ]);

  const sortedWorks = useMemo(() => [...works], [works]);
  const titleValid = titleValue.trim().length >= 1 && titleValue.trim().length <= 200;

  const toggleSetId = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string
  ): void => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectWorkFromTree = (workId: string): void => {
    setExpandedWorkIds((current) => new Set([...current, workId]));
    onSelectWork(workId);
  };

  const selectChapterFromTree = (workId: string, chapterId: string): void => {
    setExpandedWorkIds((current) => new Set([...current, workId]));
    setExpandedChapterIds((current) => new Set([...current, chapterId]));
    onSelectChapter(workId, chapterId);
  };

  const selectEpisodeFromTree = (workId: string, chapterId: string, episodeId: string): void => {
    setExpandedWorkIds((current) => new Set([...current, workId]));
    setExpandedChapterIds((current) => new Set([...current, chapterId]));
    onSelectEpisode(workId, chapterId, episodeId);
  };

  const invalidateWorks = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: worksQueryKey(sessionKey, organizationId) });
  };

  const invalidateChapters = async (workId: string): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: chaptersQueryKey(sessionKey, workId, organizationId) });
  };

  const invalidateAllEpisodes = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['episodes', sessionKey] });
  };

  const chaptersFor = async (workId: string, force = false): Promise<ChapterRecord[]> => {
    if (force) {
      await queryClient.invalidateQueries({ queryKey: chaptersQueryKey(sessionKey, workId, organizationId) });
    }
    const response = await queryClient.fetchQuery({
      queryKey: chaptersQueryKey(sessionKey, workId, organizationId),
      queryFn: () => api.getChapters(workId, organizationId)
    });
    return sortedByOrder(response.chapters);
  };

  const episodesFor = async (chapterId: string, force = false): Promise<EpisodeRecord[]> => {
    if (force) {
      await queryClient.invalidateQueries({ queryKey: episodesQueryKey(sessionKey, chapterId, organizationId) });
    }
    const response = await queryClient.fetchQuery({
      queryKey: episodesQueryKey(sessionKey, chapterId, organizationId),
      queryFn: () => api.getEpisodes(chapterId, organizationId)
    });
    return sortedByOrder(response.episodes);
  };

  const openTitleIntent = (intent: TitleIntent, initialValue = ''): void => {
    setMenuTarget(null);
    setError(null);
    setTitleValue(initialValue);
    setTitleIntent(intent);
  };

  const titleHasStaleConflict = error instanceof ApiError && error.code === 'RESOURCE_STALE';

  const reloadTitleFromIntent = async (): Promise<void> => {
    if (titleIntent === null || pending) {
      return;
    }
    setPending(true);
    try {
      if (titleIntent.kind === 'rename-work') {
        const response = await queryClient.fetchQuery({
          queryKey: workDetailQueryKey(sessionKey, titleIntent.work.id, organizationId),
          queryFn: () => api.getWork(titleIntent.work.id, organizationId),
        });
        setTitleValue(response.title);
      } else if (titleIntent.kind === 'rename-chapter') {
        const chapters = await chaptersFor(titleIntent.work.id, true);
        setTitleValue(chapters.find((chapter) => chapter.id === titleIntent.chapter.id)?.title ?? '');
      } else if (titleIntent.kind === 'rename-episode') {
        const episodes = await episodesFor(titleIntent.chapter.id, true);
        setTitleValue(episodes.find((episode) => episode.id === titleIntent.episode.id)?.title ?? '');
      }
      setError(null);
    } catch (reloadError) {
      setError(reloadError);
    } finally {
      setPending(false);
    }
  };

  const submitTitle = async (): Promise<void> => {
    if (titleIntent === null || !titleValid || pending) {
      return;
    }
    const title = titleValue.trim();
    setPending(true);
    setError(null);
    try {
      if (titleIntent.kind === 'create-work') {
        const created = await api.createWork({
          title,
          genre: null,
          world_setting: null,
          theme: null,
          main_entity_ids: [],
          starting_point: null,
          ending_point: null,
          overall_flow: null
        }, organizationId);
        setExpandedWorkIds((current) => new Set([...current, created.id]));
        await invalidateWorks();
        onSelectWork(created.id);
      } else if (titleIntent.kind === 'rename-work') {
        await api.updateWork(titleIntent.work.id, { title, expected_updated_at: titleIntent.work.updated_at }, organizationId);
        onWorkRenamed(titleIntent.work.id, title);
        await invalidateWorks();
      } else if (titleIntent.kind === 'create-chapter') {
        const create = async (force: boolean): Promise<ChapterRecord> => {
          const chapters = await chaptersFor(titleIntent.work.id, force);
          return api.createChapter(
            titleIntent.work.id,
            buildNewChapterPayload(title, chapters),
            organizationId
          );
        };
        let created: ChapterRecord;
        try {
          created = await create(false);
        } catch (createError) {
          if (!(createError instanceof ApiError) || createError.status !== 409) {
            throw createError;
          }
          created = await create(true);
        }
        setExpandedWorkIds((current) => new Set([...current, titleIntent.work.id]));
        setExpandedChapterIds((current) => new Set([...current, created.id]));
        await invalidateChapters(titleIntent.work.id);
        onSelectChapter(titleIntent.work.id, created.id);
      } else if (titleIntent.kind === 'rename-chapter') {
        await api.updateChapter(titleIntent.chapter.id, { title, expected_updated_at: titleIntent.chapter.updated_at }, organizationId);
        onChapterRenamed(titleIntent.chapter.id, title);
        await invalidateChapters(titleIntent.work.id);
      } else if (titleIntent.kind === 'create-episode') {
        const create = async (force: boolean): Promise<EpisodeRecord> => {
          const episodes = await episodesFor(titleIntent.chapter.id, force);
          return api.createEpisode(
            titleIntent.chapter.id,
            buildNewEpisodePayload(title, episodes),
            organizationId
          );
        };
        let created: EpisodeRecord;
        try {
          created = await create(false);
        } catch (createError) {
          if (!(createError instanceof ApiError) || createError.status !== 409) {
            throw createError;
          }
          created = await create(true);
        }
        setExpandedWorkIds((current) => new Set([...current, titleIntent.work.id]));
        setExpandedChapterIds((current) => new Set([...current, titleIntent.chapter.id]));
        await queryClient.invalidateQueries({
          queryKey: episodesQueryKey(sessionKey, titleIntent.chapter.id, organizationId)
        });
        onSelectEpisode(titleIntent.work.id, titleIntent.chapter.id, created.id);
      } else {
        await api.updateEpisode(titleIntent.episode.id, { title, expected_updated_at: titleIntent.episode.updated_at }, organizationId);
        onEpisodeRenamed(titleIntent.episode.id, title);
        await queryClient.invalidateQueries({
          queryKey: episodesQueryKey(sessionKey, titleIntent.chapter.id, organizationId)
        });
      }
      setTitleIntent(null);
      setTitleValue('');
    } catch (submitError) {
      setError(submitError);
    } finally {
      setPending(false);
    }
  };

  const moveChapter = async (
    target: Extract<MenuTarget, { kind: 'chapter' }>,
    direction: 'up' | 'down'
  ): Promise<void> => {
    setMenuTarget(null);
    setPending(true);
    setError(null);
    try {
      await api.moveChapter(target.chapter.id, direction, organizationId);
      await invalidateChapters(target.work.id);
    } catch (moveError) {
      setError(moveError);
    } finally {
      setPending(false);
    }
  };

  const moveEpisode = async (
    target: Extract<MenuTarget, { kind: 'episode' }>,
    direction: 'up' | 'down'
  ): Promise<void> => {
    setMenuTarget(null);
    setPending(true);
    setError(null);
    const crossChapter =
      (direction === 'up' && target.episodeIndex === 0) ||
      (direction === 'down' && target.episodeIndex === target.episodeCount - 1);
    try {
      const movedEpisode = await api.moveEpisode(target.episode.id, direction, organizationId, crossChapter);
      if (
        crossChapter &&
        selectedEpisodeId === target.episode.id &&
        movedEpisode.chapter_id !== target.chapter.id
      ) {
        selectEpisodeFromTree(target.work.id, movedEpisode.chapter_id, movedEpisode.id);
      }
      await invalidateAllEpisodes();
      await invalidateChapters(target.work.id);
    } catch (moveError) {
      setError(moveError);
    } finally {
      setPending(false);
    }
  };

  const deleteChapter = (target: Extract<MenuTarget, { kind: 'chapter' }>): void => {
    setMenuTarget(null);
    confirmDestructiveAction({
      language,
      title: t(language, "generated.components.StoryHierarchySheet.delete.chapter.e0a09ce2"),
      message: t(language, 'component.storyHierarchySheet.deleteChapterMessage', {
        title: titleForChapter(target.chapter, language)
      }),
      onConfirm: () => {
        setPending(true);
        setError(null);
        void api.deleteChapter(target.chapter.id, organizationId)
          .then(async () => {
            setExpandedChapterIds((current) => {
              const next = new Set(current);
              next.delete(target.chapter.id);
              return next;
            });
            onChapterDeleted(target.chapter.id);
            await invalidateChapters(target.work.id);
            await invalidateAllEpisodes();
          })
          .catch(setError)
          .finally(() => setPending(false));
      }
    });
  };

  const deleteEpisode = (target: Extract<MenuTarget, { kind: 'episode' }>): void => {
    setMenuTarget(null);
    confirmDestructiveAction({
      language,
      title: t(language, "generated.components.StoryHierarchySheet.delete.episode.547dddda"),
      message: t(language, 'component.storyHierarchySheet.deleteEpisodeMessage', {
        title: titleForEpisode(target.episode, language)
      }),
      onConfirm: () => {
        setPending(true);
        setError(null);
        void api.deleteEpisode(target.episode.id, organizationId)
          .then(async () => {
            onEpisodeDeleted(target.episode.id);
            await queryClient.invalidateQueries({
              queryKey: episodesQueryKey(sessionKey, target.chapter.id, organizationId)
            });
          })
          .catch(setError)
          .finally(() => setPending(false));
      }
    });
  };

  const renderMenuItems = (): React.JSX.Element[] => {
    if (menuTarget === null) {
      return [];
    }
    const items: React.JSX.Element[] = [];
    const item = (
      key: string,
      label: string,
      icon: React.JSX.Element,
      onPress: () => void,
      disabled = false,
      danger = false
    ): void => {
      items.push(
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled || pending}
          key={key}
          onPress={onPress}
          style={[styles.menuItem, danger ? styles.menuItemDanger : null, disabled ? styles.disabled : null]}
        >
          {icon}
          <Text style={[styles.menuItemLabel, danger ? styles.menuItemLabelDanger : null]}>{label}</Text>
        </Pressable>
      );
    };

    if (menuTarget.kind === 'work') {
      item(
        'rename',
        t(language, "generated.components.StoryHierarchySheet.rename.work.25fb474a"),
        <Pencil color={colors.ink} size={19} />,
        () => openTitleIntent({ kind: 'rename-work', work: menuTarget.work }, menuTarget.work.title)
      );
      item(
        'add',
        t(language, "generated.components.StoryHierarchySheet.add.chapter.774ad8c0"),
        <Plus color={colors.primary} size={19} />,
        () => openTitleIntent({ kind: 'create-chapter', work: menuTarget.work })
      );
      return items;
    }

    if (menuTarget.kind === 'chapter') {
      const target = menuTarget;
      item(
        'rename',
        t(language, "generated.components.StoryHierarchySheet.rename.chapter.17ae9932"),
        <Pencil color={colors.ink} size={19} />,
        () => openTitleIntent(
          { kind: 'rename-chapter', work: target.work, chapter: target.chapter },
          titleForChapter(target.chapter, language)
        )
      );
      item(
        'up',
        t(language, "generated.components.StoryHierarchySheet.move.chapter.up.df887d97"),
        <ArrowUp color={colors.ink} size={19} />,
        () => void moveChapter(target, 'up'),
        target.chapterIndex === 0
      );
      item(
        'down',
        t(language, "generated.components.StoryHierarchySheet.move.chapter.down.47aaa561"),
        <ArrowDown color={colors.ink} size={19} />,
        () => void moveChapter(target, 'down'),
        target.chapterIndex === target.chapterCount - 1
      );
      item(
        'add',
        t(language, "generated.components.StoryHierarchySheet.add.episode.ad67475b"),
        <Plus color={colors.primary} size={19} />,
        () => openTitleIntent({ kind: 'create-episode', work: target.work, chapter: target.chapter })
      );
      item(
        'delete',
        t(language, "generated.components.StoryHierarchySheet.delete.chapter.f8d64810"),
        <Trash2 color={colors.danger} size={19} />,
        () => deleteChapter(target),
        false,
        true
      );
      return items;
    }

    const target = menuTarget;
    item(
      'rename',
      t(language, "generated.components.StoryHierarchySheet.rename.episode.4736dfbc"),
      <Pencil color={colors.ink} size={19} />,
      () => openTitleIntent(
        { kind: 'rename-episode', work: target.work, chapter: target.chapter, episode: target.episode },
        titleForEpisode(target.episode, language)
      )
    );
    item(
      'up',
      t(language, "generated.components.StoryHierarchySheet.move.episode.up.2d9e4ca9"),
      <ArrowUp color={colors.ink} size={19} />,
      () => void moveEpisode(target, 'up'),
      !canMoveEpisodeInHierarchy({ ...target, direction: 'up' })
    );
    item(
      'down',
      t(language, "generated.components.StoryHierarchySheet.move.episode.down.f34dd42c"),
      <ArrowDown color={colors.ink} size={19} />,
      () => void moveEpisode(target, 'down'),
      !canMoveEpisodeInHierarchy({ ...target, direction: 'down' })
    );
    item(
      'delete',
      t(language, "generated.components.StoryHierarchySheet.delete.episode.2ead8f62"),
      <Trash2 color={colors.danger} size={19} />,
      () => deleteEpisode(target),
      false,
      true
    );
    return items;
  };

  const titleDialogHeading = titleIntent === null
    ? ''
    : titleIntent.kind === 'create-work'
      ? t(language, "generated.components.StoryHierarchySheet.add.work.3c9ddf25")
      : titleIntent.kind === 'rename-work'
        ? t(language, "generated.components.StoryHierarchySheet.rename.work.25fb474a")
        : titleIntent.kind === 'create-chapter'
          ? t(language, "generated.components.StoryHierarchySheet.add.chapter.774ad8c0")
          : titleIntent.kind === 'rename-chapter'
            ? t(language, "generated.components.StoryHierarchySheet.rename.chapter.17ae9932")
            : titleIntent.kind === 'create-episode'
              ? t(language, "generated.components.StoryHierarchySheet.add.episode.ad67475b")
              : t(language, "generated.components.StoryHierarchySheet.rename.episode.4736dfbc");

  const closeTopmostOverlay = (): void => {
    if (titleIntent !== null) {
      setTitleIntent(null);
      return;
    }
    if (menuTarget !== null) {
      setMenuTarget(null);
      return;
    }
    onClose();
  };

  return (
      <Modal animationType="slide" onRequestClose={closeTopmostOverlay} presentationStyle="fullScreen" visible={visible}>
        <SafeAreaView
          edges={['top', 'right', 'bottom', 'left']}
          accessibilityLabel={t(language, "generated.components.StoryHierarchySheet.story.hierarchy.28f3f754")}
          accessibilityViewIsModal
          onAccessibilityEscape={closeTopmostOverlay}
          style={styles.sheet}
        >
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeading}>
              <Text style={styles.eyebrow}>{t(language, "generated.components.StoryHierarchySheet.story.hierarchy.28f3f754")}</Text>
              <Text style={styles.sheetTitle}>{t(language, "generated.components.StoryHierarchySheet.works.chapters.and.episodes.c73674e6")}</Text>
            </View>
            <View style={styles.headerActions}>
              {canCreateWork ? (
                <Pressable
                  accessibilityLabel={t(language, "generated.components.StoryHierarchySheet.add.work.3c9ddf25")}
                  accessibilityRole="button"
                  disabled={pending}
                  onPress={() => openTitleIntent({ kind: 'create-work' })}
                  style={styles.headerIconButton}
                >
                  <Plus color={colors.primary} size={23} strokeWidth={2.2} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityLabel={t(language, "generated.components.StoryHierarchySheet.close.603bc62f")}
                accessibilityRole="button"
                onPress={onClose}
                style={styles.headerIconButton}
              >
                <X color={colors.ink} size={23} strokeWidth={2.2} />
              </Pressable>
            </View>
          </View>
          {error === null ? null : <Notice message={userErrorMessage(error, language)} tone="danger" />}
          {!canEdit ? (
            <Notice
              message={t(language, "generated.components.StoryHierarchySheet.your.role.can.select.items.but.cannot.ed.3edca1a1")}
              tone="info"
            />
          ) : null}
          <FlatList
            contentContainerStyle={styles.tree}
            data={sortedWorks}
            initialNumToRender={8}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(work) => work.id}
            ListEmptyComponent={
              <Text style={styles.emptyRoot}>
                {t(language, "generated.components.StoryHierarchySheet.no.works.yet.use.to.create.one.b9c65592")}
              </Text>
            }
            ListFooterComponent={
              isFetchingNextWorks
                ? <ActivityIndicator color={colors.primary} size="small" />
                : null
            }
            maxToRenderPerBatch={8}
            onEndReached={() => {
              if (hasNextWorks && !isFetchingNextWorks) {
                onEndReachedWorks?.();
              }
            }}
            onEndReachedThreshold={0.5}
            renderItem={({ item: work, index: workIndex }) => (
              <WorkNode
                api={api}
                canEdit={canEdit}
                expanded={effectiveExpandedWorkIds.has(work.id)}
                expandedChapterIds={effectiveExpandedChapterIds}
                key={work.id}
                language={language}
                onAddChapter={(targetWork) => openTitleIntent({ kind: 'create-chapter', work: targetWork })}
                onAddEpisode={(targetWork, targetChapter) => openTitleIntent({
                  kind: 'create-episode',
                  work: targetWork,
                  chapter: targetChapter
                })}
                onOpenMenu={setMenuTarget}
                onSelectChapter={selectChapterFromTree}
                onSelectEpisode={selectEpisodeFromTree}
                onSelectWork={selectWorkFromTree}
                onToggleChapter={(chapterId) => toggleSetId(setExpandedChapterIds, chapterId)}
                onToggleWork={(workId) => toggleSetId(setExpandedWorkIds, workId)}
                organizationId={organizationId}
                pending={pending}
                selectedChapterId={selectedChapterId}
                selectedEpisodeId={selectedEpisodeId}
                selectedWorkId={selectedWorkId}
                sessionKey={sessionKey}
                visible={visible}
                work={work}
                workIndex={workIndex}
              />
            )}
            windowSize={7}
          />
          {pending ? (
            <View style={styles.pendingBar}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.pendingLabel}>{t(language, "generated.components.StoryHierarchySheet.updating.246dcabf")}</Text>
            </View>
          ) : null}
          {menuTarget === null ? null : (
            <View pointerEvents="box-none" style={styles.overlay}>
              <Pressable
                accessibilityLabel={t(language, "generated.components.StoryHierarchySheet.close.603bc62f")}
                accessibilityRole="button"
                onPress={() => setMenuTarget(null)}
                style={styles.overlayBackdrop}
              />
              <View
                pointerEvents="box-none"
                style={[styles.menuOverlay, { paddingBottom: safeAreaInsets.bottom + spacing.lg }]}
                testID="story-hierarchy-menu-overlay"
              >
                <View
                  accessibilityLabel={t(language, "generated.components.StoryHierarchySheet.story.hierarchy.28f3f754")}
                  accessibilityViewIsModal
                  onAccessibilityEscape={() => setMenuTarget(null)}
                  onStartShouldSetResponder={() => true}
                  style={styles.menuSheet}
                >
                  <Text numberOfLines={2} style={styles.menuTitle}>
                    {menuTarget.kind === 'work'
                      ? menuTarget.work.title
                      : menuTarget.kind === 'chapter'
                        ? titleForChapter(menuTarget.chapter, language)
                        : titleForEpisode(menuTarget.episode, language)}
                  </Text>
                  {renderMenuItems()}
                </View>
              </View>
            </View>
          )}
          {titleIntent === null ? null : (
            <View pointerEvents="box-none" style={styles.overlay}>
              <Pressable
                accessibilityLabel={t(language, "generated.components.StoryHierarchySheet.close.603bc62f")}
                accessibilityRole="button"
                onPress={() => setTitleIntent(null)}
                style={styles.overlayBackdrop}
              />
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                pointerEvents="box-none"
                style={styles.titleKeyboardAvoider}
              >
                <View
                  pointerEvents="box-none"
                  style={[styles.titleOverlay, { paddingBottom: safeAreaInsets.bottom + spacing.lg }]}
                >
                  <View
                    accessibilityLabel={titleDialogHeading}
                    accessibilityViewIsModal
                    onAccessibilityEscape={() => setTitleIntent(null)}
                    onStartShouldSetResponder={() => true}
                    style={styles.titleDialog}
                  >
                    <Text style={styles.dialogTitle}>{titleDialogHeading}</Text>
                    <TextInput
                      accessibilityLabel={t(language, "generated.components.StoryHierarchySheet.title.d8135461")}
                      autoCapitalize="sentences"
                      autoCorrect={false}
                      autoFocus
                      maxLength={200}
                      onChangeText={setTitleValue}
                      onSubmitEditing={() => void submitTitle()}
                      placeholder={t(language, "generated.components.StoryHierarchySheet.enter.a.title.d4d3374f")}
                      placeholderTextColor={colors.disabled}
                      returnKeyType="done"
                      style={styles.titleInput}
                      value={titleValue}
                    />
                    {!titleValid && titleValue.length > 0 ? (
                      <Text style={styles.validation}>
                        {t(language, "generated.components.StoryHierarchySheet.enter.a.title.from.1.to.200.characters.6b024aa4")}
                      </Text>
                    ) : null}
                    {titleHasStaleConflict ? (
                      <PrimaryButton
                        disabled={pending}
                        label={t(language, "generated.components.StoryHierarchySheet.reload.latest.state.327b1d0e")}
                        onPress={() => void reloadTitleFromIntent()}
                        variant="secondary"
                      />
                    ) : null}
                    <View style={styles.dialogButtons}>
                      <PrimaryButton
                        disabled={pending}
                        label={t(language, "generated.components.StoryHierarchySheet.cancel.3672b0b9")}
                        onPress={() => setTitleIntent(null)}
                        variant="ghost"
                      />
                      <PrimaryButton
                        disabled={!titleValid || titleHasStaleConflict}
                        label={titleIntent.kind.startsWith('create-')
                          ? t(language, "generated.components.StoryHierarchySheet.add.8b69f421")
                          : t(language, "generated.components.StoryHierarchySheet.save.80b89d5e")}
                        loading={pending}
                        onPress={() => void submitTitle()}
                      />
                    </View>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </View>
          )}
        </SafeAreaView>
      </Modal>
  );
}

const styles = StyleSheet.create({
  createActionButton: {
    alignItems: 'center',
    borderColor: colors.controlBorder,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  createActionLabel: {
    ...textStyles.body,
    color: colors.primary,
    fontWeight: '700'
  },
  depthOneCreateAction: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  depthTwoCreateAction: {
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs
  },
  menuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.md
  },
  overlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  overlayBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  branch: {
    flex: 1
  },
  chevronSpacer: {
    height: 44,
    width: 44
  },
  childBranch: {
    borderLeftColor: colors.borderStrong,
    borderLeftWidth: 1,
    marginLeft: 22
  },
  depthOne: {
    paddingLeft: spacing.xs
  },
  depthTwo: {
    paddingLeft: spacing.lg
  },
  dialogButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end'
  },
  dialogTitle: {
    ...textStyles.sectionTitle
  },
  disabled: {
    opacity: 0.4
  },
  emptyBranch: {
    ...textStyles.caption,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm
  },
  emptyRoot: {
    ...textStyles.body,
    color: colors.muted,
    padding: spacing.xl,
    textAlign: 'center'
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs
  },
  headerIconButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  loadingLabel: {
    ...textStyles.caption
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg
  },
  menuItem: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  menuItemDanger: {
    backgroundColor: colors.dangerSurface
  },
  menuItemLabel: {
    ...textStyles.body,
    flex: 1,
    fontWeight: '700'
  },
  menuItemLabelDanger: {
    color: colors.danger
  },
  menuSheet: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    maxWidth: 560,
    overflow: 'hidden',
    width: '100%'
  },
  menuTitle: {
    ...textStyles.sectionTitle,
    borderBottomColor: colors.borderStrong,
    borderBottomWidth: 1,
    padding: spacing.md
  },
  pendingBar: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44
  },
  pendingLabel: {
    ...textStyles.caption,
    color: colors.primary,
    fontWeight: '700'
  },
  sheet: {
    backgroundColor: colors.canvas,
    flex: 1,
    paddingTop: spacing.md
  },
  sheetHeader: {
    alignItems: 'center',
    borderBottomColor: colors.borderStrong,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md
  },
  sheetHeading: {
    flex: 1,
    gap: 2
  },
  sheetTitle: {
    ...textStyles.title
  },
  titleDialog: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    maxWidth: 560,
    padding: spacing.lg,
    width: '100%'
  },
  titleInput: {
    backgroundColor: colors.field,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  titleKeyboardAvoider: {
    flex: 1
  },
  titleOverlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl
  },
  tree: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm
  },
  treeRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 48
  },
  treeRowSelected: {
    backgroundColor: 'rgba(229, 199, 107, 0.10)',
    borderLeftColor: colors.primary,
    borderLeftWidth: 3
  },
  treeTitle: {
    ...textStyles.body,
    flex: 1,
    fontWeight: '600'
  },
  treeTitleButton: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    minWidth: 0
  },
  treeTitleSelected: {
    color: colors.primary,
    fontWeight: '700'
  },
  validation: {
    ...textStyles.caption,
    color: colors.warning
  }
});
