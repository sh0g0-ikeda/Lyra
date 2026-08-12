import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryHierarchySheet } from '@/components/StoryHierarchySheet';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { confirmDestructiveActionMock } = vi.hoisted(() => ({
  confirmDestructiveActionMock: vi.fn(({ onConfirm }: { onConfirm: () => void }) => onConfirm())
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
  KeyboardAvoidingView: ({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement('keyboard-avoiding-view', props, children),
  Modal: ({ children, visible, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    visible ? React.createElement('modal', props, children) : null,
  Platform: { OS: 'ios' },
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
  SafeAreaView: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
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
  Notice: ({ message }: { message: string }) => React.createElement('notice', null, message)
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
  loadStoryHierarchyExpansion: vi.fn().mockResolvedValue({
    chapterIds: ['chapter-1'],
    workIds: ['work-1']
  }),
  saveStoryHierarchyExpansion: vi.fn().mockResolvedValue(undefined)
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
  const api = {
    createChapter: vi.fn(),
    createEpisode: vi.fn(),
    createWork: vi.fn(),
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
  });

  const renderSheet = async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <StoryHierarchySheet
            api={api as never}
            canCreateWork
            canEdit
            language="ja"
            onChapterDeleted={vi.fn()}
            onClose={vi.fn()}
            onEpisodeDeleted={vi.fn()}
            onSelectChapter={vi.fn()}
            onSelectEpisode={onSelectEpisode}
            onSelectWork={vi.fn()}
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
          />
        </QueryClientProvider>
      );
      for (let index = 0; index < 5; index += 1) {
        await flushQueries();
      }
    });
    if (
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

  it('フルスクリーン階層シートをiPhoneとiPadの全安全領域内に表示する', async () => {
    const renderer = await renderSheet();
    const safeArea = renderer.root.findByType('safe-area-view');

    expect(safeArea.props.edges).toEqual(['top', 'right', 'bottom', 'left']);
  });

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
    expect(renderer.root.findAllByType('modal')).toHaveLength(1);
    const nativeModal = renderer.root.findByType('modal');
    expect(nativeModal.props.presentationStyle).toBe('fullScreen');
    expect(nativeModal.props.transparent).not.toBe(true);
    const keyboardAvoider = renderer.root.findByType('keyboard-avoiding-view');
    expect(keyboardAvoider.props.behavior).toBe('padding');
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

  it('作品・章・話のメニューに仕様どおりの操作を表示する', async () => {
    const renderer = await renderSheet();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '作品Aの操作' }).props.onPress();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: '作品名を変更' })).toBeDefined();
    expect(renderer.root.findByProps({ accessibilityLabel: '章を追加' })).toBeDefined();

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '1. 第一章の操作' }).props.onPress();
    });
    for (const label of ['章名を変更', '章を上へ移動', '章を下へ移動', '話を追加', '章を削除']) {
      expect(renderer.root.findByProps({ accessibilityLabel: label })).toBeDefined();
    }

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: '1. 第一話の操作' }).props.onPress();
    });
    for (const label of ['話名を変更', '話を上へ移動', '話を下へ移動', '話を削除']) {
      expect(renderer.root.findByProps({ accessibilityLabel: label })).toBeDefined();
    }
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
});
