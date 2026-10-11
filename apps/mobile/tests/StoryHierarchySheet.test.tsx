import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryHierarchySheet } from '@/components/StoryHierarchySheet';
import { ApiError } from '@/lib/api';
import { contrastRatio, renderedColors, renderedContrast, renderedStyle } from './helpers/renderedContrast';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { confirmDestructiveActionMock, loadStoryHierarchyExpansionMock, saveStoryHierarchyExpansionMock } = vi.hoisted(() => ({
  confirmDestructiveActionMock: vi.fn(({ onConfirm }: { onConfirm: () => void }) => onConfirm()),
  loadStoryHierarchyExpansionMock: vi.fn(),
  saveStoryHierarchyExpansionMock: vi.fn()
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'activity-indicator',
  FlatList: ({
    data,
    ListEmptyComponent,
    ListFooterComponent,
    renderItem,
    ...props
  }: {
    data: { id: string }[];
    ListEmptyComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
    renderItem: (input: { item: { id: string }; index: number }) => React.ReactNode;
  }) => React.createElement(
    'flat-list',
    props,
    data.length === 0
      ? ListEmptyComponent
      : [
          ...data.map((item, index) => renderItem({ item, index })),
          ListFooterComponent,
        ],
  ),
  KeyboardAvoidingView: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('keyboard-avoiding-view', props, children),
  Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? React.createElement('modal', null, children) : null,
  Platform: { OS: 'android' },
  Pressable: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
    onPress?: () => void;
  }) => React.createElement(
    'button',
    { ...props, onClick: onPress },
    typeof children === 'function' ? children({ pressed: false }) : children
  ),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  TextInput: ({
    onChangeText,
    onSubmitEditing,
    ...props
  }: {
    onChangeText: (value: string) => void;
    onSubmitEditing?: () => void;
  }) => React.createElement('input', {
    ...props,
    onChange: onChangeText,
    onSubmit: onSubmitEditing
  }),
  View: 'view'
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('safe-area-view', props, children)
}));

vi.mock('lucide-react-native', () => {
  const icon = (name: string) => {
    const Icon = (props: Record<string, unknown>) => React.createElement(name, props);
    Icon.displayName = name;
    return Icon;
  };
  return {
    ArrowDown: icon('arrow-down'),
    ArrowUp: icon('arrow-up'),
    BookOpen: icon('book-open'),
    Check: icon('check'),
    ChevronDown: icon('chevron-down'),
    ChevronRight: icon('chevron-right'),
    FileText: icon('file-text'),
    Folder: icon('folder'),
    FolderOpen: icon('folder-open'),
    MoreHorizontal: icon('more-horizontal'),
    Pencil: icon('pencil'),
    Plus: icon('plus'),
    Trash2: icon('trash'),
    X: icon('x')
  };
});

vi.mock('@/components/Notice', () => ({
  Notice: ({ message, ...props }: { message: string }) => React.createElement('notice', props, message)
}));

vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({
    disabled,
    label,
    onPress
  }: {
    disabled?: boolean;
    label: string;
    onPress: () => void;
  }) => React.createElement('button', { disabled, onClick: onPress }, label)
}));

vi.mock('@/lib/confirm', () => ({
  confirmDestructiveAction: confirmDestructiveActionMock
}));

vi.mock('@/lib/storage', () => ({
  loadStoryHierarchyExpansion: loadStoryHierarchyExpansionMock,
  saveStoryHierarchyExpansion: saveStoryHierarchyExpansionMock
}));

const work = (id: string, title: string) => ({
  id,
  organization_id: null,
  title,
  genre: null,
  world_setting: null,
  theme: null,
  main_entity_ids: [],
  starting_point: null,
  ending_point: null,
  overall_flow: null,
  version: 1,
  status: 'draft' as const,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z'
});

const chapter = (id: string, workId: string, order: number, title: string) => ({
  id,
  work_id: workId,
  order,
  title,
  purpose: null,
  starting_state: null,
  ending_state: null,
  emotion_curve: null,
  entities_involved: [],
  key_beats: [],
  version: 1,
  status: 'draft' as const,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z'
});

const episode = (id: string, chapterId: string, order: number, title: string) => ({
  id,
  chapter_id: chapterId,
  order,
  title,
  purpose: null,
  story_input_mode: 'full' as const,
  story_full_draft: null,
  introduction: null,
  middle: null,
  climax: null,
  ending_hook: null,
  estimated_pages: 4,
  entities_involved: [],
  page_skeleton_generated: false,
  version: 1,
  status: 'draft' as const,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z'
});

const flushQueries = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('StoryHierarchySheet', () => {
  const onSelectEpisode = vi.fn();
  const onWorkRenamed = vi.fn();
  const onBeforeWorkDelete = vi.fn<() => Promise<boolean>>();
  const onWorkDeletionAccepted = vi.fn<() => Promise<void>>();
  let renderedQueryClient: QueryClient | null = null;
  const api = {
    createChapter: vi.fn(),
    createEpisode: vi.fn(),
    createWork: vi.fn(),
    deleteWork: vi.fn(),
    deleteChapter: vi.fn().mockResolvedValue(undefined),
    deleteEpisode: vi.fn().mockResolvedValue(undefined),
    getChapters: vi.fn(async (workId: string) => ({
      chapters: workId === 'work-1'
        ? [chapter('chapter-1', 'work-1', 1, '第一章'), chapter('chapter-2', 'work-1', 2, '第二章')]
        : []
    })),
    getEpisodes: vi.fn(async (chapterId: string) => ({
      episodes: chapterId === 'chapter-1'
        ? [episode('episode-1', 'chapter-1', 1, '第一話')]
        : chapterId === 'chapter-2'
          ? [episode('episode-2', 'chapter-2', 1, '第二話')]
        : []
    })),
    moveChapter: vi.fn(),
    moveEpisode: vi.fn().mockResolvedValue(episode('episode-1', 'chapter-2', 1, '第一話')),
    updateChapter: vi.fn(),
    updateEpisode: vi.fn(),
    updateWork: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    confirmDestructiveActionMock.mockImplementation(({ onConfirm }: { onConfirm: () => void }) => onConfirm());
    onBeforeWorkDelete.mockResolvedValue(true);
    onWorkDeletionAccepted.mockResolvedValue(undefined);
    api.deleteWork.mockResolvedValue({
      deletion_id: '11111111-1111-4111-8111-111111111111',
      work_id: '22222222-2222-4222-8222-222222222222',
      status: 'pending',
      blocker_code: null
    });
    loadStoryHierarchyExpansionMock.mockResolvedValue({
      chapterIds: ['chapter-1'],
      workIds: ['work-1']
    });
    saveStoryHierarchyExpansionMock.mockResolvedValue(undefined);
  });

  const sheet = (overrides: Partial<React.ComponentProps<typeof StoryHierarchySheet>> = {}) => (
    <StoryHierarchySheet
      api={api as never}
      canCreateWork
      canEdit
      language="ja"
      onChapterDeleted={vi.fn()}
      onClose={vi.fn()}
      onEpisodeDeleted={vi.fn()}
      onBeforeWorkDelete={onBeforeWorkDelete}
      onSelectChapter={vi.fn()}
      onSelectEpisode={onSelectEpisode}
      onSelectWork={vi.fn()}
      onWorkDeletionAccepted={onWorkDeletionAccepted}
      onWorkRenamed={onWorkRenamed}
      onChapterRenamed={vi.fn()}
      onEpisodeRenamed={vi.fn()}
      organizationId={null}
      selectedChapterId="chapter-1"
      selectedEpisodeId="episode-1"
      selectedWorkId="work-1"
      sessionKey="session-1"
      userId="user-1"
      visible
      works={[work('work-1', '作品A'), work('work-2', '作品B')]}
      {...overrides}
    />
  );

  const renderSheet = async (ensureCurrentEpisode = true, overrides: Partial<React.ComponentProps<typeof StoryHierarchySheet>> = {}) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    renderedQueryClient = queryClient;
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          {sheet(overrides)}
        </QueryClientProvider>
      );
    });
    for (let index = 0; index < 5; index += 1) {
      await act(flushQueries);
    }
    if (
      ensureCurrentEpisode &&
      renderer!.root.findAllByProps({ accessibilityLabel: '1. 第一話の操作' }).length === 0
    ) {
      const chapterToggle = renderer!.root.findByProps({ accessibilityLabel: '1. 第一章を折りたたむ' });
      await act(async () => {
        chapterToggle.props.onPress();
        chapterToggle.props.onPress();
        await flushQueries();
      });
    }
    return renderer!;
  };

  it('選択中の枝だけ取得し、折りたたまれた別作品の章は取得しない', async () => {
    const renderer = await renderSheet();

    expect(api.getChapters).toHaveBeenCalledWith('work-1', null);
    expect(api.getChapters).not.toHaveBeenCalledWith('work-2', null);

    const expandWorkTwo = renderer.root.findByProps({ accessibilityLabel: '作品Bを展開' });
    await act(async () => {
      expandWorkTwo.props.onPress();
      await flushQueries();
    });
    expect(api.getChapters).toHaveBeenCalledWith('work-2', null);
  });

  // Opening the creation entry point is a one-shot view intent. Tenant scope
  // changes while the sheet stays open must never replay a create operation.
  it('新規作成入口では作品追加を一度だけ開きscope変更後に再表示しない', async () => {
    const renderer = await renderSheet(false, { initialAction: 'create-work' });
    expect(renderer.root.findAllByType('input')).toHaveLength(1);

    await act(async () => {
      renderer.root.findAllByType('button').find((button) => button.children.join('') === 'キャンセル')?.props.onClick();
    });
    expect(renderer.root.findAllByType('input')).toHaveLength(0);

    await act(async () => {
      renderer.update(
        <QueryClientProvider client={renderedQueryClient!}>
          {sheet({ initialAction: 'create-work', organizationId: 'org-2' })}
        </QueryClientProvider>
      );
      await flushQueries();
    });
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
  });

  it('作品追加を開いたままscopeが変わった場合は旧入力を閉じる', async () => {
    const renderer = await renderSheet(false, { initialAction: 'create-work' });
    await act(async () => renderer.root.findByType('input').props.onChange('旧scopeの作品'));

    await act(async () => {
      renderer.update(
        <QueryClientProvider client={renderedQueryClient!}>
          {sheet({ initialAction: 'create-work', organizationId: 'org-2' })}
        </QueryClientProvider>
      );
      await flushQueries();
    });

    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(api.createWork).not.toHaveBeenCalled();
  });

  it('sheetを閉じた場合は作品追加の入力を次の通常表示へ持ち越さない', async () => {
    const renderer = await renderSheet(false, { initialAction: 'create-work' });
    await act(async () => renderer.root.findByType('input').props.onChange('閉じる前の作品'));
    await act(async () => {
      renderer.update(
        <QueryClientProvider client={renderedQueryClient!}>
          {sheet({ initialAction: 'create-work', visible: false })}
        </QueryClientProvider>
      );
      await flushQueries();
    });
    await act(async () => {
      renderer.update(
        <QueryClientProvider client={renderedQueryClient!}>
          {sheet({ initialAction: undefined, visible: true })}
        </QueryClientProvider>
      );
      await flushQueries();
    });

    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(api.createWork).not.toHaveBeenCalled();
  });

  it('作品作成権限を失った場合は古い保存操作から作成しない', async () => {
    const renderer = await renderSheet(false, { initialAction: 'create-work' });
    await act(async () => renderer.root.findByType('input').props.onChange('権限外の作品'));
    const staleAdd = renderer.root.findAllByType('button').find((button) => button.children.join('') === '追加')?.props.onClick as (() => void) | undefined;

    await act(async () => {
      renderer.update(
        <QueryClientProvider client={renderedQueryClient!}>
          {sheet({ canCreateWork: false, initialAction: 'create-work' })}
        </QueryClientProvider>
      );
      await flushQueries();
    });
    await act(async () => {
      staleAdd?.();
      await flushQueries();
    });

    expect(api.createWork).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
  });

  it('旧scopeの作成待機中でも新scopeで再入力でき旧結果は選択やdialogを変更しない', async () => {
    let resolveCreateWork: ((value: ReturnType<typeof work>) => void) | null = null;
    api.createWork.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCreateWork = resolve;
    }));
    const onSelectWork = vi.fn();
    const renderer = await renderSheet(false, { initialAction: 'create-work', onSelectWork });
    await act(async () => renderer.root.findByType('input').props.onChange('旧scopeの作品'));
    await act(async () => {
      renderer.root.findAllByType('button').find((button) => button.children.join('') === '追加')?.props.onClick();
      await Promise.resolve();
    });

    await act(async () => {
      renderer.update(
        <QueryClientProvider client={renderedQueryClient!}>
          {sheet({ initialAction: 'create-work', onSelectWork, organizationId: 'org-2' })}
        </QueryClientProvider>
      );
      await flushQueries();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '作品を追加' }).props.onPress();
    });
    await act(async () => renderer.root.findByType('input').props.onChange('新scopeの作品'));
    await act(async () => {
      resolveCreateWork?.(work('old-created-work', '旧scopeの作品'));
      await flushQueries();
    });

    expect(onSelectWork).not.toHaveBeenCalled();
    expect(renderer.root.findByType('input').props.value).toBe('新scopeの作品');
  });

  it('同じscopeでsheetを閉じ再表示した場合も旧作成結果は新dialogを閉じない', async () => {
    let resolveCreateWork: ((value: ReturnType<typeof work>) => void) | null = null;
    api.createWork.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCreateWork = resolve;
    }));
    const onSelectWork = vi.fn();
    const renderer = await renderSheet(false, { initialAction: 'create-work', onSelectWork });
    await act(async () => renderer.root.findByType('input').props.onChange('古い作品'));
    await act(async () => {
      renderer.root.findAllByType('button').find((button) => button.children.join('') === '追加')?.props.onClick();
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(
        <QueryClientProvider client={renderedQueryClient!}>
          {sheet({ initialAction: 'create-work', onSelectWork, visible: false })}
        </QueryClientProvider>
      );
      await flushQueries();
    });
    await act(async () => {
      renderer.update(
        <QueryClientProvider client={renderedQueryClient!}>
          {sheet({ initialAction: undefined, onSelectWork, visible: true })}
        </QueryClientProvider>
      );
      await flushQueries();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '作品を追加' }).props.onPress();
    });
    await act(async () => renderer.root.findByType('input').props.onChange('新しい作品'));
    await act(async () => {
      resolveCreateWork?.(work('old-created-work', '古い作品'));
      await flushQueries();
    });

    expect(onSelectWork).not.toHaveBeenCalled();
    expect(renderer.root.findByType('input').props.value).toBe('新しい作品');
  });

  it('作品取得中または失敗時は作品なしと表示せず安全に再試行できる', async () => {
    const retry = vi.fn();
    const loadingRenderer = await renderSheet(false, {
      isLoadingWorks: true,
      selectedChapterId: null,
      selectedEpisodeId: null,
      selectedWorkId: null,
      works: []
    });
    expect(JSON.stringify(loadingRenderer.toJSON())).not.toContain('作品はまだありません');
    expect(loadingRenderer.root.findAllByType('activity-indicator').length).toBeGreaterThan(0);

    const failedRenderer = await renderSheet(false, {
      hierarchyError: new Error('private detail'),
      isLoadingWorks: false,
      onRetryHierarchy: retry,
      selectedChapterId: null,
      selectedEpisodeId: null,
      selectedWorkId: null,
      works: []
    });
    expect(JSON.stringify(failedRenderer.toJSON())).not.toContain('作品はまだありません');
    const notice = failedRenderer.root.findByType('notice');
    expect(notice.children.join('')).not.toContain('private detail');
  });

  it('作成権限がない場合は新規作成入口でも作品追加を開かない', async () => {
    const renderer = await renderSheet(false, {
      canCreateWork: false,
      initialAction: 'create-work'
    });
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
  });

  it('章または話の取得失敗を空階層と誤表示せず再試行を案内する', async () => {
    api.getChapters.mockRejectedValueOnce(new Error('private chapter detail'));
    const chaptersRenderer = await renderSheet(false);
    expect(JSON.stringify(chaptersRenderer.toJSON())).not.toContain('章はまだありません');
    expect(chaptersRenderer.root.findByType('notice').children.join('')).not.toContain('private chapter detail');

    api.getEpisodes.mockRejectedValueOnce(new Error('private episode detail'));
    const episodesRenderer = await renderSheet(false);
    expect(JSON.stringify(episodesRenderer.toJSON())).not.toContain('話はまだありません');
    expect(episodesRenderer.root.findByType('notice').children.join('')).not.toContain('private episode detail');
  });

  // A FlatList cell must measure its hierarchy content, otherwise the episode rows can sit
  // below an unscrollable cell after a user expands a chapter from the page editor.
  it('章を展開したとき話まで到達できる高さで表示する', async () => {
    const renderer = await renderSheet();

    expect(renderer.root.findByProps({ accessibilityLabel: '1. 第一話の操作' })).toBeDefined();
    const branches = renderer.root.findAll((node) => {
      const style = node.props.style as { flex?: number } | undefined;
      return style?.flex === 1 && Object.keys(style).length === 1;
    });
    expect(branches).toHaveLength(0);
  });

  it('ページ編集中に別の章を展開してもその話を選べる', async () => {
    const renderer = await renderSheet(false);
    const expandSecondChapter = renderer.root.findByProps({ accessibilityLabel: '2. 第二章を展開' });

    await act(async () => {
      expandSecondChapter.props.onPress();
    });
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        await flushQueries();
      });
    }

    expect(api.getEpisodes).toHaveBeenCalledWith('chapter-2', null);
    expect(renderer.root.findByProps({ accessibilityLabel: '1. 第二話の操作' })).toBeDefined();
  });

  it('展開設定の読込中に別の章を開いても話を隠さない', async () => {
    let resolveStoredExpansion: ((value: { chapterIds: string[]; workIds: string[] }) => void) | null = null;
    loadStoryHierarchyExpansionMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStoredExpansion = resolve;
    }));
    const renderer = await renderSheet(false);
    const expandSecondChapter = renderer.root.findByProps({ accessibilityLabel: '2. 第二章を展開' });
    await act(async () => {
      expandSecondChapter.props.onPress();
      resolveStoredExpansion?.({ chapterIds: ['chapter-1'], workIds: ['work-1'] });
      await flushQueries();
    });
    for (let index = 0; index < 5; index += 1) {
      await act(flushQueries);
    }

    expect(renderer.root.findByProps({ accessibilityLabel: '1. 第二話の操作' })).toBeDefined();
  });

  it('読込中に開いて閉じた章を保存済み展開で再び開かない', async () => {
    let resolveStoredExpansion: ((value: { chapterIds: string[]; workIds: string[] }) => void) | null = null;
    loadStoryHierarchyExpansionMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveStoredExpansion = resolve;
    }));
    const renderer = await renderSheet(false);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '2. 第二章を展開' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '2. 第二章を折りたたむ' }).props.onPress();
      resolveStoredExpansion?.({ chapterIds: ['chapter-2'], workIds: ['work-1'] });
      await flushQueries();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: '2. 第二章を展開' })).toBeDefined();
  });

  it('scopeを切り替えた後は遅れて届く旧scopeの展開設定を保存しない', async () => {
    const resolvers: ((value: { chapterIds: string[]; workIds: string[] }) => void)[] = [];
    loadStoryHierarchyExpansionMock.mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));
    const renderer = await renderSheet(false);
    expect(renderedQueryClient).not.toBeNull();
    await act(async () => {
      renderer.update(
        <QueryClientProvider client={renderedQueryClient!}>
          {sheet({ organizationId: 'org-2', selectedChapterId: null, selectedEpisodeId: null, selectedWorkId: null, userId: 'user-2' })}
        </QueryClientProvider>
      );
    });
    await act(async () => {
      resolvers[1]!({ chapterIds: ['chapter-2'], workIds: ['work-1'] });
      await flushQueries();
    });
    for (let index = 0; index < 3; index += 1) {
      await act(flushQueries);
    }
    expect(renderer.root.findByProps({ accessibilityLabel: '2. 第二章を折りたたむ' })).toBeDefined();
    await act(async () => {
      resolvers[0]!({ chapterIds: ['chapter-1'], workIds: ['work-1'] });
      await flushQueries();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: '2. 第二章を折りたたむ' })).toBeDefined();
    const latestSave = saveStoryHierarchyExpansionMock.mock.calls.at(-1);
    expect(latestSave).toEqual(['user-2', 'org-2', { chapterIds: ['chapter-2'], workIds: ['work-1'] }]);
  });

  it('章末の話を下へ移動すると章境界移動フラグを送る', async () => {
    const renderer = await renderSheet();
    const chapterToggle = renderer.root.findByProps({ accessibilityLabel: '1. 第一章を折りたたむ' });
    await act(async () => {
      chapterToggle.props.onPress();
      chapterToggle.props.onPress();
      await flushQueries();
    });
    const episodeMenu = renderer.root.findByProps({ accessibilityLabel: '1. 第一話の操作' });
    await act(async () => {
      episodeMenu.props.onPress();
    });
    const moveDown = renderer.root.findByProps({ accessibilityLabel: '話を下へ移動' });
    await act(async () => {
      moveDown.props.onPress();
      await flushQueries();
    });

    expect(api.moveEpisode).toHaveBeenCalledWith('episode-1', 'down', null, true);
    expect(onSelectEpisode).toHaveBeenCalledWith('work-1', 'chapter-2', 'episode-1');
  });

  it('作品名の変更はtitleだけを送る', async () => {
    const renderer = await renderSheet();
    const workMenu = renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' });
    await act(async () => {
      workMenu.props.onPress();
    });
    const rename = renderer.root.findByProps({ accessibilityLabel: '作品名を変更' });
    await act(async () => {
      rename.props.onPress();
    });
    const input = renderer.root.findByProps({ accessibilityLabel: 'タイトル' });
    await act(async () => {
      input.props.onChangeText('変更後の作品');
    });
    const save = renderer.root
      .findAllByType('button')
      .find((button) => button.children.join('') === '保存');
    expect(save).toBeDefined();
    await act(async () => {
      save?.props.onClick();
      await flushQueries();
    });

    expect(api.updateWork).toHaveBeenCalledWith(
      'work-1',
      { title: '変更後の作品', expected_updated_at: '2026-07-01T00:00:00.000Z' },
      null,
    );
    expect(onWorkRenamed).toHaveBeenCalledWith('work-1', '変更後の作品');
  });

  it('タイトル保存失敗を開いているmodal内で一度だけ表示し入力と操作対象を保持する', async () => {
    api.updateWork.mockRejectedValueOnce(new Error('private provider detail'));
    const renderer = await renderSheet();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品名を変更' }).props.onPress());
    await act(async () => renderer.root.findByType('input').props.onChange('入力を保持'));
    await act(async () => {
      renderer.root.findAllByType('button').find(button => button.children.join('') === '保存')?.props.onClick();
      await flushQueries();
    });
    const titleModal = renderer.root.findAllByType('modal').find(modal => modal.findAllByType('input').length > 0)!;
    const notices = titleModal.findAllByType('notice');
    expect(notices).toHaveLength(1);
    expect(renderer.root.findAllByType('notice')).toHaveLength(1);
    expect(notices[0].children.join('')).toContain('作品名の保存');
    expect(notices[0].children.join('')).toContain('作品A');
    expect(notices[0].children.join('')).toContain('未確認');
    expect(notices[0].children.join('')).not.toContain('private provider detail');
    expect(titleModal.findByType('input').props.value).toBe('入力を保持');
    expect(api.updateWork).toHaveBeenCalledOnce();
  });
  it('作成完了後の読み込み失敗では再作成せず表示の更新だけで回復する', async () => {
    api.createWork.mockResolvedValueOnce(work('new-work', '作成済み作品'));
    const renderer = await renderSheet();
    const invalidation = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockRejectedValueOnce(new Error('refresh failed'));
    try {
      await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品を追加' }).props.onPress());
      await act(async () => renderer.root.findByType('input').props.onChange('作成済み作品'));
      await act(async () => {
        renderer.root.findAllByType('button').find(button => button.children.join('') === '追加')?.props.onClick();
        await flushQueries();
      });
      const notice = renderer.root.findByType('notice');
      expect(notice.children.join('')).toContain('サーバーで操作の完了を確認');
      expect(renderer.root.findAllByType('button').find(button => button.children.join('') === '追加')?.props.disabled).toBe(true);
      expect(notice.props.actionLabel).toBe('状態を更新');
      await act(async () => { notice.props.onAction(); await flushQueries(); });
      expect(api.createWork).toHaveBeenCalledOnce();
      expect(renderer.root.findAllByType('input')).toHaveLength(0);
    } finally { invalidation.mockRestore(); }
  });

  it('タイトルdialogを開いた場合に有効placeholderと入力境界が読める', async () => {
    const renderer = await renderSheet();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品名を変更' }).props.onPress());
    const input = renderer.root.findByType('input');
    await act(async () => input.props.onChange(''));
    expect(renderedContrast(input, input.props.placeholderTextColor)).toBeGreaterThanOrEqual(4.5);
    const pixels = renderedColors(input, renderedStyle(input.props.style).borderColor as string);
    expect(contrastRatio(pixels.foreground, pixels.background)).toBeGreaterThanOrEqual(3);
    const outside = renderedColors(input.parent!, '#FFFFFF').background;
    expect(contrastRatio(pixels.foreground, outside)).toBeGreaterThanOrEqual(3);
    act(() => renderer.unmount());
  });

  it('作品・章・話のメニューに仕様どおりの操作を表示する', async () => {
    const renderer = await renderSheet();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: '作品名を変更' })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: '章を追加' })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: '作品を永久削除' })).toBeDefined();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '1. 第一章の操作' }).props.onPress();
    });
    for (const label of ['章名を変更', '章を上へ移動', '章を下へ移動', '話を追加', '章を削除']) {
      expect(renderer.root.findByProps({ accessibilityLabel: label })).toBeDefined();
    }
    const deleteChapter = renderer.root.findAllByType('button').find((node) => node.props.accessibilityLabel === '章を削除')!;
    expect(deleteChapter.props.disabled).toBe(false);
    expect(renderedContrast(deleteChapter.findByType('text'))).toBeGreaterThanOrEqual(4.5);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '1. 第一話の操作' }).props.onPress();
    });
    for (const label of ['話名を変更', '話を上へ移動', '話を下へ移動', '話を削除']) {
      expect(renderer.root.findByProps({ accessibilityLabel: label })).toBeDefined();
    }
  });

  it('階層画面と下部メニューを端末のSafe Area内に表示する', async () => {
    const renderer = await renderSheet();

    expect(renderer.root.findAllByType('safe-area-view')).toHaveLength(1);
    expect(renderer.root.findByType('safe-area-view').props.edges).toEqual(['top', 'bottom']);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '1. 第一章の操作' }).props.onPress();
    });

    const safeAreas = renderer.root.findAllByType('safe-area-view');
    expect(safeAreas).toHaveLength(2);
    expect(safeAreas[1]?.props.edges).toEqual(['bottom']);
  });

  it('話追加ダイアログをAndroidのSafe Area内の中上部に表示する', async () => {
    const renderer = await renderSheet();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '1. 第一章の操作' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '話を追加' }).props.onPress();
    });

    const safeAreas = renderer.root.findAllByType('safe-area-view');
    expect(safeAreas).toHaveLength(2);
    expect(safeAreas[1]?.props.edges).toEqual(['top', 'bottom']);
    expect(safeAreas[1]?.props.style).toMatchObject({
      justifyContent: 'flex-start'
    });
    expect(renderer.root.findByType('keyboard-avoiding-view').props.behavior).toBe('height');
    expect(renderer.root.findByProps({ accessibilityLabel: '話を追加' })).toBeDefined();
  });

  it('話の削除は確認ダイアログを経由する', async () => {
    const renderer = await renderSheet();
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '1. 第一話の操作' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '話を削除' }).props.onPress();
      await flushQueries();
    });

    expect(confirmDestructiveActionMock).toHaveBeenCalledOnce();
    expect(api.deleteEpisode).toHaveBeenCalledWith('episode-1', null);
  });

  it('作品削除の確認をキャンセルした場合は削除要求を送らない', async () => {
    confirmDestructiveActionMock.mockImplementation(() => undefined);
    const renderer = await renderSheet();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品を永久削除' }).props.onPress());

    expect(confirmDestructiveActionMock).toHaveBeenCalledOnce();
    expect(api.deleteWork).not.toHaveBeenCalled();
  });

  it('dirty確認中に組織scopeが変わった場合は古い作品の削除要求を送らない', async () => {
    let resolveDirty: ((allowed: boolean) => void) | undefined;
    onBeforeWorkDelete.mockReturnValue(new Promise<boolean>((resolve) => { resolveDirty = resolve; }));
    const renderer = await renderSheet();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress());
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品を永久削除' }).props.onPress());
    await act(async () => renderer.update(
      <QueryClientProvider client={renderedQueryClient!}>
        {sheet({ organizationId: '33333333-3333-4333-8333-333333333333' })}
      </QueryClientProvider>
    ));
    await act(async () => { resolveDirty?.(true); await flushQueries(); });

    expect(api.deleteWork).not.toHaveBeenCalled();
    expect(onWorkDeletionAccepted).not.toHaveBeenCalled();
  });

  it('削除要求の202受付後は完了扱いせずreceiptを監視側へ渡す', async () => {
    const receipt = {
      deletion_id: '11111111-1111-4111-8111-111111111111',
      work_id: '22222222-2222-4222-8222-222222222222',
      status: 'pending' as const,
      blocker_code: null
    };
    api.deleteWork.mockResolvedValue(receipt);
    const renderer = await renderSheet();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress());
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '作品を永久削除' }).props.onPress(); await flushQueries(); });

    expect(onBeforeWorkDelete).toHaveBeenCalledWith('work-1');
    expect(api.deleteWork).toHaveBeenCalledWith('work-1', null);
    expect(onWorkDeletionAccepted).toHaveBeenCalledWith(receipt);
    const confirmation = confirmDestructiveActionMock.mock.calls[0]?.[0] as { message: string };
    expect(confirmation.message).toContain('画像');
    expect(confirmation.message).toContain('章');
    expect(confirmation.message).toContain('話');
    expect(confirmation.message).toContain('元に戻せません');
  });

  it('削除要求待機中にscopeが変わった場合は新scopeの選択を解除しない', async () => {
    let resolveDelete: ((receipt: { deletion_id: string; work_id: string; status: 'pending'; blocker_code: null }) => void) | undefined;
    api.deleteWork.mockReturnValue(new Promise((resolve) => { resolveDelete = resolve; }));
    const renderer = await renderSheet();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress());
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '作品を永久削除' }).props.onPress(); await flushQueries(); });
    await act(async () => renderer.update(
      <QueryClientProvider client={renderedQueryClient!}>
        {sheet({ organizationId: '33333333-3333-4333-8333-333333333333' })}
      </QueryClientProvider>
    ));
    await act(async () => {
      resolveDelete?.({
        deletion_id: '11111111-1111-4111-8111-111111111111',
        work_id: '22222222-2222-4222-8222-222222222222',
        status: 'pending',
        blocker_code: null
      });
      await flushQueries();
    });

    expect(api.deleteWork).toHaveBeenCalledWith('work-1', null);
    expect(onWorkDeletionAccepted).not.toHaveBeenCalled();
  });

  it('削除要求の通信結果が不明な場合は状態更新だけを行いDELETEを再送しない', async () => {
    api.deleteWork.mockRejectedValue(new Error('network unavailable'));
    const renderer = await renderSheet();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress());
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '作品を永久削除' }).props.onPress(); await flushQueries(); });
    const notice = renderer.root.findByType('notice');
    await act(async () => { notice.props.onAction(); await flushQueries(); });

    expect(api.deleteWork).toHaveBeenCalledOnce();
    expect(onWorkDeletionAccepted).not.toHaveBeenCalled();
  });

  it('削除409は進行中処理と保存結果の安全確認の両方を案内する', async () => {
    api.deleteWork.mockRejectedValue(new ApiError('conflict', 409, 'CONFLICT'));
    const renderer = await renderSheet();
    await act(async () => renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress());
    await act(async () => { renderer.root.findByProps({ accessibilityLabel: '作品を永久削除' }).props.onPress(); await flushQueries(); });

    const notice = String(renderer.root.findByType('notice').props.children);
    expect(notice).toContain('安全確認が必要');
    expect(notice).toContain('サポートへお問い合わせください');
    expect(api.deleteWork).toHaveBeenCalledOnce();
  });
});
