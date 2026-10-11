import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MangaLibrary } from '@/components/MangaLibrary';
import type { WorkspaceContextData } from '@/components/WorkspaceContextPicker';
import type { WorkRecord } from '@/domain/types';
import { colors } from '@/constants/theme';
import { defaultSelection } from '@/lib/queryKeys';
import { t } from '@/lib/i18n';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let canCreate = true;
let selection = { ...defaultSelection, organizationId: 'org', workId: 'old-work' };
const updateSelection = vi.fn<() => Promise<boolean>>();
const onResume = vi.fn();
const onOpenGuide = vi.fn();
let root: ReactTestRenderer | undefined;
vi.mock('react-native', () => ({ Pressable: 'button', Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('@/components/MangaTutorial', () => ({ MangaTutorial: (props: Record<string, unknown>) => React.createElement('tutorial', props) }));
vi.mock('@/components/Screen', () => ({ Screen: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('screen', props, children) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/components/ActionableErrorNotice', () => ({ ActionableErrorNotice: (props: Record<string, unknown>) => React.createElement('error', props) }));
vi.mock('@/components/StoryHierarchySheet', () => ({ StoryHierarchySheet: (props: Record<string, unknown>) => React.createElement('hierarchy', props) }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api: {}, hasCapability: () => canCreate, language: 'ja', logout: vi.fn(), selection, session: { user: { id: 'user' } }, sessionKey: 'session', updateSelection }) }));
const work = { id: 'work', title: '漫画作品' } as WorkRecord;
function context(works: WorkRecord[] = []): WorkspaceContextData {
  return { works, chapters: [], episodes: [], selectedWorkId: null, selectedChapterId: null, selectedEpisodeId: null, error: null, isLoadingWorks: false, isLoadingChapters: false, isLoadingEpisodes: false, hasMoreWorks: false, isFetchingMoreWorks: false, loadMoreWorks: vi.fn(), retry: vi.fn() };
}
async function render(value = context()): Promise<void> {
  await act(async () => { root = create(<MangaLibrary context={value} onResume={onResume} onOpenGuide={onOpenGuide} resumeStep="story" loadingProgress={false} progressError={null} onRetryProgress={vi.fn()} />); });
}
async function press(id: string): Promise<void> {
  await act(async () => { root?.root.findAll((node) => node.type === 'button' && node.props.testID === id)[0].props.onPress(); });
}

// Spec §10 Mobile: one-tap creation reuses authorized hierarchy CRUD; browsing
// never creates. Pending hierarchy is not empty and selection stays legible.
describe('漫画一覧と既存階層の保持', () => {
  beforeEach(() => { canCreate = true; selection = { ...defaultSelection, organizationId: 'org', workId: 'old-work' }; updateSelection.mockReset().mockResolvedValue(true); onResume.mockReset(); onOpenGuide.mockReset(); });
  afterEach(async () => { await act(async () => { root?.unmount(); }); root = undefined; });

  it.each([[], [work]])('空一覧と既存一覧の両方で作成CTAが既存階層UIを開く', async (item) => {
    await render(context(item === undefined ? [] : [item]));
    await press('manga-create');
    expect(root?.root.findByType('hierarchy').props.visible).toBe(true);
    expect(root?.root.findByType('hierarchy').props.initialAction).toBe('create-work');
    expect(updateSelection).not.toHaveBeenCalled();
  });

  it('作品を選ぶと法人を変えず階層の古い子選択だけを解除する', async () => {
    await render(context([work])); await press('manga-work-work');
    expect(updateSelection).toHaveBeenCalledWith({ workId: 'work', chapterId: null, episodeId: null, pageId: null, entityId: null });
    expect(root?.root.findByType('hierarchy').props.organizationId).toBe('org');
    expect(root?.root.findByType('hierarchy').props.visible).toBe(true);
  });

  it('作品変更のdirty確認キャンセル時には一覧と元選択を維持する', async () => {
    updateSelection.mockResolvedValue(false);
    await render(context([work])); await press('manga-work-work');
    expect(root?.root.findByType('hierarchy').props.visible).toBe(false);
    expect(selection.workId).toBe('old-work');
  });

  it('同じ作品を開く場合に選択中の章や話を初期化しない', async () => {
    selection.workId = 'work';
    await render(context([work])); await press('manga-work-work');
    expect(updateSelection).not.toHaveBeenCalled();
  });

  it('閲覧者には作成権限を渡さずガイド入口を維持する', async () => {
    canCreate = false;
    await render(); await press('manga-create');
    const hierarchy = root?.root.findByType('hierarchy');
    expect(hierarchy?.props.initialAction).toBeUndefined();
    expect(hierarchy?.props.canCreateWork).toBe(false);
    expect(hierarchy?.props.canEdit).toBe(false);
    await press('manga-guide');
    expect(onOpenGuide).toHaveBeenCalledOnce();
  });
  it('ホームはログイン中でも言語切替を表示し選択した話の編集入口だけを残す', async () => {
    await render(context([work]));
    expect(root?.root.findByType('screen').props.chrome).toBe('language');
    expect(root?.root.findAll((node) => node.props.testID === 'manga-start-story')).toHaveLength(0);
  });

  it('新規作成を閉じてから作品を開く場合に作成ポップアップを再表示しない', async () => {
    await render(context([work])); await press('manga-create');
    await act(async () => { root?.root.findByType('hierarchy').props.onClose(); });
    await press('manga-work-work');
    expect(root?.root.findByType('hierarchy').props.visible).toBe(true);
    expect(root?.root.findByType('hierarchy').props.initialAction).toBeUndefined();
  });

  it('一覧読み込み中は空作品と表示せず階層へ状態と再試行を渡す', async () => {
    const value = { ...context(), isLoadingWorks: true, error: new Error('temporarily unavailable') };
    await render(value);
    const hierarchy = root?.root.findByType('hierarchy');
    expect(hierarchy?.props.isLoadingWorks).toBe(true);
    expect(hierarchy?.props.hierarchyError).toBe(value.error);
    expect(hierarchy?.props.onRetryHierarchy).toBe(value.retry);
    expect(root?.root.findAll((node) => node.type === 'text' && node.props.children === t('ja', 'emptyWorks'))).toHaveLength(0);
  });

  it('選択中の作品は黄色背景と黒文字でほかの作品と区別できる', async () => {
    const other = { ...work, id: 'other', title: '別の作品' };
    await render({ ...context([work, other]), selectedWorkId: work.id });
    const selected = root!.root.findByProps({ testID: 'manga-work-work' });
    const unselected = root!.root.findByProps({ testID: 'manga-work-other' });
    const flatten = (style: unknown): Record<string, unknown> => Object.assign({}, ...(Array.isArray(style) ? style : [style])) as Record<string, unknown>;
    expect(flatten(selected.props.style).backgroundColor).toBe(colors.primary);
    for (const text of selected.findAllByType('text')) expect(flatten(text.props.style).color).toBe(colors.primaryText);
    expect(flatten(unselected.props.style).backgroundColor).toBe(colors.surface);
    expect(flatten(unselected.findAllByType('text')[0].props.style).color).toBe(colors.inkStrong);
  });

  it('取得待ちのホームは作品なしと表示せず成功した空一覧だけに案内を出す', async () => {
    await render({ ...context(), isLoadingWorks: true });
    expect(root?.root.findAll((node) => node.type === 'text' && node.props.children === t('ja', 'emptyWorks'))).toHaveLength(0);
    await act(async () => { root?.unmount(); }); root = undefined;
    await render(context());
    expect(root?.root.findAll((node) => node.type === 'text' && node.props.children === t('ja', 'emptyWorks'))).toHaveLength(1);
  });

});
