import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  EllipsisVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

import { ApiError, type LyraApiClient } from '../lib/api';
import {
  getAppendOrder,
  parseExpandedNodeIds,
  resolveEpisodeMove,
  sortStoryItems,
  type StoryMoveDirection,
} from '../lib/storyHierarchy';
import type { ChapterRecord, EpisodeRecord, WorkRecord } from '../types/api';

type UiLanguage = 'ja' | 'en';
type RunAction = (label: string, action: () => Promise<string | void>) => Promise<void>;

interface StoryHierarchyTreeProps {
  api: LyraApiClient;
  works: WorkRecord[];
  language: UiLanguage;
  organizationId: string | null;
  storageScope: string;
  selectedWorkId: string;
  selectedChapterId: string;
  selectedEpisodeId: string;
  busyAction: string | null;
  scopedQueryKey: (queryKey: readonly unknown[]) => readonly unknown[];
  invalidateScopedQuery: (queryKey: readonly unknown[]) => Promise<void>;
  runAction: RunAction;
  onSelectWork: (workId: string) => void;
  onSelectChapter: (workId: string, chapterId: string) => void;
  onSelectEpisode: (workId: string, chapterId: string, episodeId: string) => void;
  onChapterMetadataChanged: (chapter: ChapterRecord) => void;
  onEpisodeMetadataChanged: (episode: EpisodeRecord) => void;
}

interface WorkNodeProps extends Omit<StoryHierarchyTreeProps, 'works' | 'storageScope'> {
  work: WorkRecord;
  expanded: boolean;
  expandedChapterIds: ReadonlySet<string>;
  onToggleWork: (workId: string) => void;
  onToggleChapter: (chapterId: string) => void;
  onEnsureChapterExpanded: (chapterId: string) => void;
}

interface ChapterNodeProps extends Omit<WorkNodeProps, 'work' | 'expanded' | 'onToggleWork'> {
  workId: string;
  chapter: ChapterRecord;
  chapters: ChapterRecord[];
  chapterIndex: number;
  expanded: boolean;
}

interface HierarchyMenuAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

function text(language: UiLanguage, english: string, japanese: string): string {
  return language === 'ja' ? japanese : english;
}

function storageKeyFor(scope: string, kind: 'works' | 'chapters'): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9:_-]/gu, '_').slice(0, 180) || 'session';
  return `lyra-story-tree-expanded-${kind}:${safeScope}`;
}

function readStoredIds(key: string): string[] {
  return parseExpandedNodeIds(window.localStorage.getItem(key) ?? '[]');
}

function titleOrFallback(title: string | null, language: UiLanguage, kind: 'chapter' | 'episode'): string {
  if (title !== null && title.trim().length > 0) {
    return title;
  }
  return kind === 'chapter'
    ? text(language, 'Untitled chapter', '無題の章')
    : text(language, 'Untitled episode', '無題の話');
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

export function StoryHierarchyTree(props: StoryHierarchyTreeProps) {
  const workStorageKey = useMemo(() => storageKeyFor(props.storageScope, 'works'), [props.storageScope]);
  const chapterStorageKey = useMemo(() => storageKeyFor(props.storageScope, 'chapters'), [props.storageScope]);
  const [expandedWorkIds, setExpandedWorkIds] = useState<string[]>(() => readStoredIds(workStorageKey));
  const [expandedChapterIds, setExpandedChapterIds] = useState<string[]>(() => readStoredIds(chapterStorageKey));

  useEffect(() => {
    setExpandedWorkIds(readStoredIds(workStorageKey));
    setExpandedChapterIds(readStoredIds(chapterStorageKey));
  }, [chapterStorageKey, workStorageKey]);

  const updateExpandedWorks = useCallback((updater: (current: string[]) => string[]): void => {
    setExpandedWorkIds((current) => {
      const next = updater(current);
      window.localStorage.setItem(workStorageKey, JSON.stringify(next));
      return next;
    });
  }, [workStorageKey]);

  const updateExpandedChapters = useCallback((updater: (current: string[]) => string[]): void => {
    setExpandedChapterIds((current) => {
      const next = updater(current);
      window.localStorage.setItem(chapterStorageKey, JSON.stringify(next));
      return next;
    });
  }, [chapterStorageKey]);

  const ensureWorkExpanded = useCallback((workId: string): void => {
    if (workId.length === 0) {
      return;
    }
    updateExpandedWorks((current) => (current.includes(workId) ? current : [...current, workId]));
  }, [updateExpandedWorks]);

  const ensureChapterExpanded = useCallback((chapterId: string): void => {
    if (chapterId.length === 0) {
      return;
    }
    updateExpandedChapters((current) => (current.includes(chapterId) ? current : [...current, chapterId]));
  }, [updateExpandedChapters]);

  useEffect(() => {
    ensureWorkExpanded(props.selectedWorkId);
  }, [ensureWorkExpanded, props.selectedWorkId]);

  useEffect(() => {
    ensureChapterExpanded(props.selectedChapterId);
  }, [ensureChapterExpanded, props.selectedChapterId]);

  const expandedWorkSet = useMemo(() => new Set(expandedWorkIds), [expandedWorkIds]);
  const expandedChapterSet = useMemo(() => new Set(expandedChapterIds), [expandedChapterIds]);

  const toggleWork = (workId: string): void => {
    updateExpandedWorks((current) =>
      current.includes(workId) ? current.filter((id) => id !== workId) : [...current, workId],
    );
  };

  const toggleChapter = (chapterId: string): void => {
    updateExpandedChapters((current) =>
      current.includes(chapterId) ? current.filter((id) => id !== chapterId) : [...current, chapterId],
    );
  };

  return (
    <div className="story-hierarchy" role="tree" aria-label={text(props.language, 'Works, chapters, and episodes', '作品・章・話')}>
      {props.works.map((work) => (
        <StoryWorkNode
          {...props}
          expanded={expandedWorkSet.has(work.id)}
          expandedChapterIds={expandedChapterSet}
          key={work.id}
          onEnsureChapterExpanded={ensureChapterExpanded}
          onToggleChapter={toggleChapter}
          onToggleWork={toggleWork}
          work={work}
        />
      ))}
    </div>
  );
}

function StoryWorkNode(props: WorkNodeProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(props.work.title);
  const [addingChapter, setAddingChapter] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const chapterQueryKey = props.scopedQueryKey(['chapters', props.work.id]);
  const chaptersQuery = useQuery({
    queryKey: chapterQueryKey,
    queryFn: () => props.api.getChapters(props.work.id, props.organizationId),
    enabled: props.expanded || props.selectedWorkId === props.work.id,
    placeholderData: (previousData) => previousData,
  });
  const chapters = useMemo(
    () => sortStoryItems(chaptersQuery.data?.chapters ?? []),
    [chaptersQuery.data?.chapters],
  );
  const busy = props.busyAction !== null;

  useEffect(() => {
    if (!renaming) {
      setRenameTitle(props.work.title);
    }
  }, [props.work.title, renaming]);

  const saveRename = (): void => {
    const title = renameTitle.trim();
    if (title.length === 0 || title === props.work.title) {
      setRenaming(false);
      setRenameTitle(props.work.title);
      return;
    }
    void props.runAction('Save work', async () => {
      await props.api.updateWork(props.work.id, { title }, props.organizationId);
      await props.invalidateScopedQuery(['works']);
      setRenaming(false);
    });
  };

  const createChapter = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const title = newChapterTitle.trim();
    if (title.length === 0) {
      return;
    }
    await props.runAction('Create chapter', async () => {
      let order = getAppendOrder(chapters);
      let created: ChapterRecord;
      try {
        created = await props.api.createChapter(props.work.id, { order, title }, props.organizationId);
      } catch (error) {
        if (!isConflict(error)) {
          throw error;
        }
        const refreshed = await props.api.getChapters(props.work.id, props.organizationId);
        order = getAppendOrder(refreshed.chapters);
        created = await props.api.createChapter(props.work.id, { order, title }, props.organizationId);
      }
      setNewChapterTitle('');
      setAddingChapter(false);
      await props.invalidateScopedQuery(['chapters', props.work.id]);
      props.onSelectChapter(props.work.id, created.id);
    });
  };

  return (
    <div className="story-hierarchy-node story-hierarchy-work" role="treeitem" aria-expanded={props.expanded}>
      <div className={`story-hierarchy-row story-hierarchy-work-row ${props.selectedWorkId === props.work.id ? 'active' : ''}`}>
        <button
          aria-label={text(props.language, props.expanded ? 'Collapse work' : 'Expand work', props.expanded ? '作品を閉じる' : '作品を開く')}
          className="story-hierarchy-toggle"
          onClick={() => props.onToggleWork(props.work.id)}
          type="button"
        >
          {props.expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <BookOpen className="story-hierarchy-kind-icon" size={15} />
        {renaming ? (
          <InlineTitleEditor
            ariaLabel={text(props.language, 'Work title', '作品名')}
            language={props.language}
            onCancel={() => {
              setRenaming(false);
              setRenameTitle(props.work.title);
            }}
            onSave={saveRename}
            setValue={setRenameTitle}
            value={renameTitle}
          />
        ) : (
          <button
            className="story-hierarchy-title"
            onClick={() => props.onSelectWork(props.work.id)}
            title={props.work.title}
            type="button"
          >
            {props.work.title}
          </button>
        )}
        {!renaming ? (
          <HierarchyActionMenu
            actions={[
              {
                icon: <Pencil size={15} />,
                label: text(props.language, 'Rename work', '作品名を変更'),
                onSelect: () => setRenaming(true),
              },
              {
                icon: <Plus size={16} />,
                label: text(props.language, 'Add chapter', '章を追加'),
                onSelect: () => {
                  if (!props.expanded) {
                    props.onToggleWork(props.work.id);
                  }
                  setAddingChapter(true);
                },
              },
            ]}
            disabled={busy}
            label={text(
              props.language,
              `Actions for work “${props.work.title}”`,
              `作品「${props.work.title}」の操作`,
            )}
          />
        ) : null}
      </div>

      {props.expanded ? (
        <div className="story-hierarchy-children" role="group">
          {addingChapter ? (
            <form className="story-hierarchy-inline-create story-hierarchy-chapter-indent" onSubmit={(event) => void createChapter(event)}>
              <Folder size={14} />
              <input
                aria-label={text(props.language, 'New chapter title', '新しい章タイトル')}
                autoFocus
                maxLength={200}
                onChange={(event) => setNewChapterTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setAddingChapter(false);
                    setNewChapterTitle('');
                  }
                }}
                placeholder={text(props.language, 'New chapter', '新しい章')}
                value={newChapterTitle}
              />
              <TreeIconButton disabled={busy || newChapterTitle.trim().length === 0} label={text(props.language, 'Create chapter', '章を作成')} submit>
                <Check size={14} />
              </TreeIconButton>
              <TreeIconButton
                disabled={busy}
                label={text(props.language, 'Cancel', 'キャンセル')}
                onClick={() => {
                  setAddingChapter(false);
                  setNewChapterTitle('');
                }}
              >
                <X size={14} />
              </TreeIconButton>
            </form>
          ) : null}
          {chaptersQuery.isLoading ? <TreeLoading language={props.language} label="chapters" /> : null}
          {chaptersQuery.isError ? (
            <TreeQueryError language={props.language} onRetry={() => void chaptersQuery.refetch()} />
          ) : null}
          {chapters.map((chapter, chapterIndex) => (
            <StoryChapterNode
              {...props}
              chapter={chapter}
              chapterIndex={chapterIndex}
              chapters={chapters}
              expanded={props.expandedChapterIds.has(chapter.id)}
              key={chapter.id}
              workId={props.work.id}
            />
          ))}
          {chaptersQuery.isSuccess && chapters.length === 0 && !addingChapter ? (
            <button className="story-hierarchy-empty-action" onClick={() => setAddingChapter(true)} type="button">
              <Plus size={14} />
              {text(props.language, 'Add the first chapter', '最初の章を追加')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StoryChapterNode(props: ChapterNodeProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(titleOrFallback(props.chapter.title, props.language, 'chapter'));
  const [addingEpisode, setAddingEpisode] = useState(false);
  const [newEpisodeTitle, setNewEpisodeTitle] = useState('');
  const episodesQuery = useQuery({
    queryKey: props.scopedQueryKey(['episodes', props.chapter.id]),
    queryFn: () => props.api.getEpisodes(props.chapter.id, props.organizationId),
    enabled: props.expanded || props.selectedChapterId === props.chapter.id,
    placeholderData: (previousData) => previousData,
  });
  const episodes = useMemo(
    () => sortStoryItems(episodesQuery.data?.episodes ?? []),
    [episodesQuery.data?.episodes],
  );
  const chapterTitle = titleOrFallback(props.chapter.title, props.language, 'chapter');
  const busy = props.busyAction !== null;

  useEffect(() => {
    if (!renaming) {
      setRenameTitle(chapterTitle);
    }
  }, [chapterTitle, renaming]);

  const saveRename = (): void => {
    const title = renameTitle.trim();
    if (title.length === 0 || title === chapterTitle) {
      setRenaming(false);
      setRenameTitle(chapterTitle);
      return;
    }
    void props.runAction('Save chapter', async () => {
      const updated = await props.api.updateChapter(props.chapter.id, { title }, props.organizationId);
      props.onChapterMetadataChanged(updated);
      await props.invalidateScopedQuery(['chapters', props.workId]);
      setRenaming(false);
    });
  };

  const moveChapter = (direction: StoryMoveDirection): void => {
    void props.runAction('Move chapter', async () => {
      const moved = await props.api.moveChapter(props.chapter.id, direction, props.organizationId);
      props.onChapterMetadataChanged(moved);
      await props.invalidateScopedQuery(['chapters', props.workId]);
    });
  };

  const deleteChapter = (): void => {
    if (!window.confirm(text(
      props.language,
      `Delete chapter “${chapterTitle}”? Episodes and their editing data will also be deleted. This cannot be undone.`,
      `章「${chapterTitle}」を本当に削除しますか？\n章内の話と編集データも削除され、元に戻せません。`,
    ))) {
      return;
    }
    void props.runAction('Delete chapter', async () => {
      await props.api.deleteChapter(props.chapter.id, props.organizationId);
      if (props.selectedChapterId === props.chapter.id) {
        props.onSelectWork(props.workId);
      }
      await props.invalidateScopedQuery(['chapters', props.workId]);
    });
  };

  const createEpisode = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const title = newEpisodeTitle.trim();
    if (title.length === 0) {
      return;
    }
    await props.runAction('Create episode', async () => {
      let order = getAppendOrder(episodes);
      let created: EpisodeRecord;
      try {
        created = await props.api.createEpisode(props.chapter.id, { order, title }, props.organizationId);
      } catch (error) {
        if (!isConflict(error)) {
          throw error;
        }
        const refreshed = await props.api.getEpisodes(props.chapter.id, props.organizationId);
        order = getAppendOrder(refreshed.episodes);
        created = await props.api.createEpisode(props.chapter.id, { order, title }, props.organizationId);
      }
      setNewEpisodeTitle('');
      setAddingEpisode(false);
      await props.invalidateScopedQuery(['episodes', props.chapter.id]);
      props.onSelectEpisode(props.workId, props.chapter.id, created.id);
    });
  };

  const moveEpisode = (episode: EpisodeRecord, episodeIndex: number, direction: StoryMoveDirection): void => {
    const resolution = resolveEpisodeMove(props.chapters, props.chapter.id, episodeIndex, episodes.length, direction);
    if (!resolution.allowed) {
      return;
    }
    void props.runAction('Move episode', async () => {
      const moved = await props.api.moveEpisode(episode.id, direction, props.organizationId, resolution.crossesChapter);
      props.onEpisodeMetadataChanged(moved);
      await props.invalidateScopedQuery(['episodes', props.chapter.id]);
      if (moved.chapter_id !== props.chapter.id) {
        props.onEnsureChapterExpanded(moved.chapter_id);
        await props.invalidateScopedQuery(['episodes', moved.chapter_id]);
      }
      if (props.selectedEpisodeId === episode.id) {
        props.onSelectEpisode(props.workId, moved.chapter_id, episode.id);
      }
    });
  };

  const deleteEpisode = (episode: EpisodeRecord, episodeIndex: number): void => {
    const episodeTitle = titleOrFallback(episode.title, props.language, 'episode');
    if (!window.confirm(text(
      props.language,
      `Delete episode “${episodeTitle}”? Its editing data will also be deleted. This cannot be undone.`,
      `話「${episodeTitle}」を本当に削除しますか？\nこの話に紐づく編集データも削除され、元に戻せません。`,
    ))) {
      return;
    }
    void props.runAction('Delete episode', async () => {
      await props.api.deleteEpisode(episode.id, props.organizationId);
      if (props.selectedEpisodeId === episode.id) {
        const remaining = episodes.filter((item) => item.id !== episode.id);
        const next = remaining[Math.min(episodeIndex, remaining.length - 1)] ?? null;
        if (next === null) {
          props.onSelectChapter(props.workId, props.chapter.id);
        } else {
          props.onSelectEpisode(props.workId, props.chapter.id, next.id);
        }
      }
      await props.invalidateScopedQuery(['episodes', props.chapter.id]);
    });
  };

  return (
    <div className="story-hierarchy-node story-hierarchy-chapter" role="treeitem" aria-expanded={props.expanded}>
      <div className={`story-hierarchy-row story-hierarchy-chapter-row ${props.selectedChapterId === props.chapter.id ? 'active' : ''}`}>
        <button
          aria-label={text(props.language, props.expanded ? 'Collapse chapter' : 'Expand chapter', props.expanded ? '章を閉じる' : '章を開く')}
          className="story-hierarchy-toggle"
          onClick={() => props.onToggleChapter(props.chapter.id)}
          type="button"
        >
          {props.expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        {props.expanded ? <FolderOpen className="story-hierarchy-kind-icon" size={15} /> : <Folder className="story-hierarchy-kind-icon" size={15} />}
        {renaming ? (
          <InlineTitleEditor
            ariaLabel={text(props.language, 'Chapter title', '章タイトル')}
            language={props.language}
            onCancel={() => {
              setRenaming(false);
              setRenameTitle(chapterTitle);
            }}
            onSave={saveRename}
            setValue={setRenameTitle}
            value={renameTitle}
          />
        ) : (
          <button
            className="story-hierarchy-title"
            onClick={() => props.onSelectChapter(props.workId, props.chapter.id)}
            title={`${props.chapter.order}. ${chapterTitle}`}
            type="button"
          >
            <span className="story-hierarchy-order">{props.chapter.order}</span>
            {chapterTitle}
          </button>
        )}
        {!renaming ? (
          <HierarchyActionMenu
            actions={[
              {
                icon: <Pencil size={15} />,
                label: text(props.language, 'Rename chapter', '章名を変更'),
                onSelect: () => setRenaming(true),
              },
              {
                icon: <Plus size={16} />,
                label: text(props.language, 'Add episode', '話を追加'),
                onSelect: () => {
                  if (!props.expanded) {
                    props.onToggleChapter(props.chapter.id);
                  }
                  setAddingEpisode(true);
                },
              },
              {
                disabled: props.chapterIndex === 0,
                icon: <ChevronUp size={15} />,
                label: text(props.language, 'Move chapter up', '章を上へ'),
                onSelect: () => moveChapter('up'),
                separatorBefore: true,
              },
              {
                disabled: props.chapterIndex === props.chapters.length - 1,
                icon: <ChevronDown size={15} />,
                label: text(props.language, 'Move chapter down', '章を下へ'),
                onSelect: () => moveChapter('down'),
              },
              {
                danger: true,
                icon: <Trash2 size={15} />,
                label: text(props.language, 'Delete chapter', '章を削除'),
                onSelect: deleteChapter,
                separatorBefore: true,
              },
            ]}
            disabled={busy}
            label={text(
              props.language,
              `Actions for chapter “${chapterTitle}”`,
              `章「${chapterTitle}」の操作`,
            )}
          />
        ) : null}
      </div>

      {props.expanded ? (
        <div className="story-hierarchy-children story-hierarchy-episode-group" role="group">
          {addingEpisode ? (
            <form className="story-hierarchy-inline-create story-hierarchy-episode-indent" onSubmit={(event) => void createEpisode(event)}>
              <FileText size={14} />
              <input
                aria-label={text(props.language, 'New episode title', '新しい話タイトル')}
                autoFocus
                maxLength={200}
                onChange={(event) => setNewEpisodeTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setAddingEpisode(false);
                    setNewEpisodeTitle('');
                  }
                }}
                placeholder={text(props.language, 'New episode', '新しい話')}
                value={newEpisodeTitle}
              />
              <TreeIconButton disabled={busy || newEpisodeTitle.trim().length === 0} label={text(props.language, 'Create episode', '話を作成')} submit>
                <Check size={14} />
              </TreeIconButton>
              <TreeIconButton
                disabled={busy}
                label={text(props.language, 'Cancel', 'キャンセル')}
                onClick={() => {
                  setAddingEpisode(false);
                  setNewEpisodeTitle('');
                }}
              >
                <X size={14} />
              </TreeIconButton>
            </form>
          ) : null}
          {episodesQuery.isLoading ? <TreeLoading language={props.language} label="episodes" /> : null}
          {episodesQuery.isError ? (
            <TreeQueryError language={props.language} onRetry={() => void episodesQuery.refetch()} />
          ) : null}
          {episodes.map((episode, episodeIndex) => {
            const episodeTitle = titleOrFallback(episode.title, props.language, 'episode');
            const up = resolveEpisodeMove(props.chapters, props.chapter.id, episodeIndex, episodes.length, 'up');
            const down = resolveEpisodeMove(props.chapters, props.chapter.id, episodeIndex, episodes.length, 'down');
            return (
              <EpisodeRow
                busy={busy}
                downAllowed={down.allowed}
                episode={episode}
                episodeTitle={episodeTitle}
                key={episode.id}
                language={props.language}
                onDelete={() => deleteEpisode(episode, episodeIndex)}
                onMoveDown={() => moveEpisode(episode, episodeIndex, 'down')}
                onMoveUp={() => moveEpisode(episode, episodeIndex, 'up')}
                onRename={async (title) => {
                  let saved = false;
                  await props.runAction('Save episode', async () => {
                    const updated = await props.api.updateEpisode(episode.id, { title }, props.organizationId);
                    props.onEpisodeMetadataChanged(updated);
                    await props.invalidateScopedQuery(['episodes', props.chapter.id]);
                    saved = true;
                  });
                  return saved;
                }}
                onSelect={() => props.onSelectEpisode(props.workId, props.chapter.id, episode.id)}
                selected={props.selectedEpisodeId === episode.id}
                upAllowed={up.allowed}
              />
            );
          })}
          {episodesQuery.isSuccess && episodes.length === 0 && !addingEpisode ? (
            <button className="story-hierarchy-empty-action story-hierarchy-episode-indent" onClick={() => setAddingEpisode(true)} type="button">
              <Plus size={14} />
              {text(props.language, 'Add the first episode', '最初の話を追加')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EpisodeRow(props: {
  episode: EpisodeRecord;
  episodeTitle: string;
  language: UiLanguage;
  selected: boolean;
  busy: boolean;
  upAllowed: boolean;
  downAllowed: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onRename: (title: string) => Promise<boolean>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(props.episodeTitle);

  useEffect(() => {
    if (!renaming) {
      setRenameTitle(props.episodeTitle);
    }
  }, [props.episodeTitle, renaming]);

  const saveRename = (): void => {
    const title = renameTitle.trim();
    if (title.length === 0 || title === props.episodeTitle) {
      setRenaming(false);
      setRenameTitle(props.episodeTitle);
      return;
    }
    void props.onRename(title).then((saved) => {
      if (saved) {
        setRenaming(false);
      }
    });
  };

  return (
    <div className={`story-hierarchy-row story-hierarchy-episode-row ${props.selected ? 'active' : ''}`} role="treeitem">
      <span className="story-hierarchy-toggle-spacer" />
      <FileText className="story-hierarchy-kind-icon" size={14} />
      {renaming ? (
        <InlineTitleEditor
          ariaLabel={text(props.language, 'Episode title', '話タイトル')}
          language={props.language}
          onCancel={() => {
            setRenaming(false);
            setRenameTitle(props.episodeTitle);
          }}
          onSave={saveRename}
          setValue={setRenameTitle}
          value={renameTitle}
        />
      ) : (
        <button className="story-hierarchy-title" onClick={props.onSelect} title={`${props.episode.order}. ${props.episodeTitle}`} type="button">
          <span className="story-hierarchy-order">{props.episode.order}</span>
          {props.episodeTitle}
        </button>
      )}
      {!renaming ? (
        <HierarchyActionMenu
          actions={[
            {
              icon: <Pencil size={15} />,
              label: text(props.language, 'Rename episode', '話名を変更'),
              onSelect: () => setRenaming(true),
            },
            {
              disabled: !props.upAllowed,
              icon: <ChevronUp size={15} />,
              label: text(props.language, 'Move episode up', '話を上へ'),
              onSelect: props.onMoveUp,
              separatorBefore: true,
            },
            {
              disabled: !props.downAllowed,
              icon: <ChevronDown size={15} />,
              label: text(props.language, 'Move episode down', '話を下へ'),
              onSelect: props.onMoveDown,
            },
            {
              danger: true,
              icon: <Trash2 size={15} />,
              label: text(props.language, 'Delete episode', '話を削除'),
              onSelect: props.onDelete,
              separatorBefore: true,
            },
          ]}
          disabled={props.busy}
          label={text(
            props.language,
            `Actions for episode “${props.episodeTitle}”`,
            `話「${props.episodeTitle}」の操作`,
          )}
        />
      ) : null}
    </div>
  );
}

function InlineTitleEditor(props: {
  ariaLabel: string;
  language: UiLanguage;
  value: string;
  setValue: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      props.onSave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      props.onCancel();
    }
  };

  return (
    <div className="story-hierarchy-inline-editor">
      <input
        aria-label={props.ariaLabel}
        autoFocus
        maxLength={200}
        onChange={(event) => props.setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        value={props.value}
      />
      <TreeIconButton disabled={props.value.trim().length === 0} label={text(props.language, 'Save name', '名前を保存')} onClick={props.onSave}>
        <Check size={13} />
      </TreeIconButton>
      <TreeIconButton label={text(props.language, 'Cancel', 'キャンセル')} onClick={props.onCancel}>
        <X size={13} />
      </TreeIconButton>
    </div>
  );
}

const HIERARCHY_MENU_WIDTH = 208;
const HIERARCHY_MENU_EDGE_GAP = 8;
const HIERARCHY_MENU_TRIGGER_GAP = 4;

function HierarchyActionMenu(props: {
  actions: HierarchyMenuAction[];
  disabled: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusEdgeRef = useRef<'first' | 'last'>('first');
  const menuId = useId();

  const enabledItemIndexes = useMemo(
    () => props.actions.flatMap((action, index) => (action.disabled === true ? [] : [index])),
    [props.actions],
  );

  const closeMenu = useCallback((restoreFocus: boolean): void => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const placeMenu = useCallback((): void => {
    const trigger = triggerRef.current;
    if (trigger === null) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const separators = props.actions.filter((action) => action.separatorBefore === true).length;
    const itemHeight = window.matchMedia('(max-width: 760px)').matches ? 42 : 36;
    const estimatedHeight = props.actions.length * itemHeight + separators * 5 + 8;
    const spaceBelow = window.innerHeight - rect.bottom - HIERARCHY_MENU_TRIGGER_GAP;
    const openAbove = spaceBelow < estimatedHeight && rect.top >= estimatedHeight + HIERARCHY_MENU_TRIGGER_GAP;
    const unclampedTop = openAbove
      ? rect.top - estimatedHeight - HIERARCHY_MENU_TRIGGER_GAP
      : rect.bottom + HIERARCHY_MENU_TRIGGER_GAP;
    const top = Math.min(
      Math.max(HIERARCHY_MENU_EDGE_GAP, unclampedTop),
      Math.max(HIERARCHY_MENU_EDGE_GAP, window.innerHeight - estimatedHeight - HIERARCHY_MENU_EDGE_GAP),
    );
    const left = Math.min(
      Math.max(HIERARCHY_MENU_EDGE_GAP, rect.right - HIERARCHY_MENU_WIDTH),
      Math.max(HIERARCHY_MENU_EDGE_GAP, window.innerWidth - HIERARCHY_MENU_WIDTH - HIERARCHY_MENU_EDGE_GAP),
    );
    setPosition({ left, top });
  }, [props.actions]);

  useEffect(() => {
    if (props.disabled && open) {
      closeMenu(false);
    }
  }, [closeMenu, open, props.disabled]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    placeMenu();
    const focusFrame = window.requestAnimationFrame(() => {
      const targetIndex = focusEdgeRef.current === 'last'
        ? enabledItemIndexes.at(-1)
        : enabledItemIndexes[0];
      if (targetIndex !== undefined) {
        itemRefs.current[targetIndex]?.focus();
      }
    });

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      closeMenu(false);
    };
    const handleViewportChange = (): void => placeMenu();

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeMenu, enabledItemIndexes, open, placeMenu]);

  const openMenu = (focusEdge: 'first' | 'last'): void => {
    focusEdgeRef.current = focusEdge;
    setOpen(true);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      closeMenu(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const activeIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    const currentEnabledPosition = enabledItemIndexes.indexOf(activeIndex);
    let targetIndex: number | undefined;
    if (event.key === 'Home') {
      targetIndex = enabledItemIndexes[0];
    } else if (event.key === 'End') {
      targetIndex = enabledItemIndexes.at(-1);
    } else if (event.key === 'ArrowDown') {
      const nextPosition = currentEnabledPosition < 0 ? 0 : (currentEnabledPosition + 1) % enabledItemIndexes.length;
      targetIndex = enabledItemIndexes[nextPosition];
    } else {
      const previousPosition = currentEnabledPosition <= 0 ? enabledItemIndexes.length - 1 : currentEnabledPosition - 1;
      targetIndex = enabledItemIndexes[previousPosition];
    }
    if (targetIndex !== undefined) {
      itemRefs.current[targetIndex]?.focus();
    }
  };

  const selectAction = (action: HierarchyMenuAction): void => {
    if (action.disabled === true) {
      return;
    }
    closeMenu(false);
    action.onSelect();
    window.requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        triggerRef.current?.focus();
      }
    });
  };

  return (
    <div className="story-hierarchy-menu-anchor">
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={props.label}
        className="story-hierarchy-menu-trigger"
        disabled={props.disabled}
        onClick={() => {
          if (open) {
            closeMenu(false);
          } else {
            openMenu('first');
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        title={props.label}
        type="button"
      >
        <EllipsisVertical size={18} />
      </button>
      {open && position !== null
        ? createPortal(
            <div
              aria-label={props.label}
              className="story-hierarchy-action-menu"
              id={menuId}
              onKeyDown={handleMenuKeyDown}
              ref={menuRef}
              role="menu"
              style={{ left: position.left, top: position.top }}
            >
              {props.actions.map((action, index) => (
                <button
                  className={`story-hierarchy-menu-item${action.danger === true ? ' danger' : ''}${action.separatorBefore === true ? ' separator-before' : ''}`}
                  disabled={action.disabled === true}
                  key={action.label}
                  onClick={() => selectAction(action)}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  type="button"
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function TreeIconButton(props: {
  children: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  submit?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      aria-label={props.label}
      className={`story-hierarchy-icon-button ${props.danger === true ? 'danger' : ''}`}
      disabled={props.disabled === true}
      onClick={props.onClick}
      title={props.label}
      type={props.submit === true ? 'submit' : 'button'}
    >
      {props.children}
    </button>
  );
}

function TreeLoading(props: { language: UiLanguage; label: 'chapters' | 'episodes' }) {
  return (
    <div className="story-hierarchy-status">
      <LoaderCircle className="spin" size={13} />
      {props.label === 'chapters'
        ? text(props.language, 'Loading chapters...', '章を読み込み中...')
        : text(props.language, 'Loading episodes...', '話を読み込み中...')}
    </div>
  );
}

function TreeQueryError(props: { language: UiLanguage; onRetry: () => void }) {
  return (
    <div className="story-hierarchy-status error">
      <span>{text(props.language, 'Could not load this folder.', 'この階層を読み込めませんでした。')}</span>
      <button onClick={props.onRetry} type="button">{text(props.language, 'Retry', '再試行')}</button>
    </div>
  );
}
