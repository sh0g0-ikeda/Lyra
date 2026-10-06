import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MangaLibrary } from '@/components/MangaLibrary';
import type { WorkspaceContextData } from '@/components/WorkspaceContextPicker';
import type { WorkRecord } from '@/domain/types';
import { defaultSelection } from '@/lib/queryKeys';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let canCreate = true;
let selection = { ...defaultSelection, organizationId: 'org', workId: 'old-work' };
const updateSelection = vi.fn<() => Promise<boolean>>();
const onResume = vi.fn();
const onOpenGuide = vi.fn();
let root: ReactTestRenderer | undefined;
vi.mock('react-native', () => ({ Pressable: 'button', Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('@/components/MangaTutorial', () => ({ MangaTutorial: (props: Record<string, unknown>) => React.createElement('tutorial', props) }));
vi.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => React.createElement('screen', null, children) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/components/ActionableErrorNotice', () => ({ ActionableErrorNotice: (props: Record<string, unknown>) => React.createElement('error', props) }));
vi.mock('@/components/StoryHierarchySheet', () => ({ StoryHierarchySheet: (props: Record<string, unknown>) => React.createElement('hierarchy', props) }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api: {}, hasCapability: () => canCreate, language: 'ja', logout: vi.fn(), selection, session: { user: { id: 'user' } }, sessionKey: 'session', updateSelection }) }));
const work = { id: 'work', title: '漫画作品' } as WorkRecord;
function context(works: WorkRecord[] = []): WorkspaceContextData {
  return { works, chapters: [], episodes: [], selectedWorkId: null, selectedChapterId: null, selectedEpisodeId: null, error: null, hasMoreWorks: false, isFetchingMoreWorks: false, loadMoreWorks: vi.fn(), retry: vi.fn() };
}
async function render(value = context()): Promise<void> {
  await act(async () => { root = create(<MangaLibrary context={value} onResume={onResume} onOpenGuide={onOpenGuide} resumeStep="story" loadingProgress={false} progressError={null} onRetryProgress={vi.fn()} />); });
}
async function press(id: string): Promise<void> {
  await act(async () => { root?.root.findAll((node) => node.type === 'button' && node.props.testID === id)[0].props.onPress(); });
}

describe('漫画一覧と既存階層の保持', () => {
  beforeEach(() => { canCreate = true; selection = { ...defaultSelection, organizationId: 'org', workId: 'old-work' }; updateSelection.mockReset().mockResolvedValue(true); onResume.mockReset(); onOpenGuide.mockReset(); });
  afterEach(async () => { await act(async () => { root?.unmount(); }); root = undefined; });

  it.each([[], [work]])('空一覧と既存一覧の両方で作成CTAが既存階層UIを開く', async (item) => {
    await render(context(item === undefined ? [] : [item]));
    await press('manga-create');
    expect(root?.root.findByType('hierarchy').props.visible).toBe(true);
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
    expect(hierarchy?.props.canCreateWork).toBe(false);
    expect(hierarchy?.props.canEdit).toBe(false);
    await press('manga-guide');
    expect(onOpenGuide).toHaveBeenCalledOnce();
  });
});
