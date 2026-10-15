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
let language: 'en' | 'ja' = 'ja';
let selection = { ...defaultSelection, organizationId: 'org', workId: 'old-work' };
const updateSelection = vi.fn<() => Promise<boolean>>();
const onResume = vi.fn();
let root: ReactTestRenderer | undefined;
const { resolveDirtyEditors } = vi.hoisted(() => ({ resolveDirtyEditors: vi.fn() }));
vi.mock('react-native', () => ({
  KeyboardAvoidingView: 'keyboard', Platform: { OS: 'android' }, Pressable: 'button', RefreshControl: 'refresh',
  ScrollView: 'scroll', StatusBar: 'status', Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles }
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'safe-area' }));
vi.mock('@/components/MangaTutorial', () => ({ MangaTutorial: (props: Record<string, unknown>) => React.createElement('tutorial', props) }));
vi.mock('@/components/Notice', () => ({ Notice: 'notice' }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/components/ActionableErrorNotice', () => ({ ActionableErrorNotice: (props: Record<string, unknown>) => React.createElement('error', props) }));
vi.mock('@/components/StoryHierarchySheet', () => ({ StoryHierarchySheet: (props: Record<string, unknown>) => React.createElement('hierarchy', props) }));
vi.mock('@/components/WorkDeletionStatusList', () => ({ WorkDeletionStatusList: (props: Record<string, unknown>) => React.createElement('work-deletions', props) }));
vi.mock('@/state/appState', () => ({
  useAppState: () => ({ api: {}, hasCapability: () => canCreate, language, logout: vi.fn(), selection, session: { user: { id: 'user' } }, sessionKey: 'session', updateSelection }),
  useOptionalAppState: () => ({ session: { user: { id: 'user' } } })
}));
vi.mock('@/state/dirtyState', () => ({ useDirtyState: () => ({ resolveDirtyEditors }) }));
vi.mock('@/state/networkStatus', () => ({ useNetworkStatus: () => ({ language, online: true, setLanguage: vi.fn() }) }));
const work = { id: 'work', title: '漫画作品' } as WorkRecord;
function context(works: WorkRecord[] = []): WorkspaceContextData {
  return { works, chapters: [], episodes: [], selectedWorkId: null, selectedChapterId: null, selectedEpisodeId: null, error: null, isLoadingWorks: false, isLoadingChapters: false, isLoadingEpisodes: false, hasMoreWorks: false, isFetchingMoreWorks: false, loadMoreWorks: vi.fn(), retry: vi.fn() };
}
async function render(value = context()): Promise<void> {
  await act(async () => { root = create(<MangaLibrary context={value} onResume={onResume} resumeStep="story" loadingProgress={false} progressError={null} onRetryProgress={vi.fn()} />); });
}
async function press(id: string): Promise<void> {
  await act(async () => { root?.root.findAll((node) => node.type === 'button' && node.props.testID === id)[0].props.onPress(); });
}

// Spec §10 Mobile: one-tap creation reuses authorized hierarchy CRUD; browsing
// never creates. Pending hierarchy is not empty and selection stays legible.
describe('漫画一覧と既存階層の保持', () => {
  beforeEach(() => { canCreate = true; language = 'ja'; selection = { ...defaultSelection, organizationId: 'org', workId: 'old-work' }; updateSelection.mockReset().mockResolvedValue(true); resolveDirtyEditors.mockReset().mockResolvedValue(true); onResume.mockReset(); });
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

  it('閲覧者には作成権限を渡さず通常の階層表示を開く', async () => {
    canCreate = false;
    await render(); await press('manga-create');
    const hierarchy = root?.root.findByType('hierarchy');
    expect(hierarchy?.props.initialAction).toBeUndefined();
    expect(hierarchy?.props.canCreateWork).toBe(false);
    expect(hierarchy?.props.canEdit).toBe(false);
  });
  it('ホームはログイン中でも言語切替を表示し選択した話の編集入口だけを残す', async () => {
    await render(context([work]));
    expect(root?.root.findByProps({ accessibilityLabel: 'English' })).toBeDefined();
    expect(root?.root.findAll((node) => node.props.testID === 'manga-start-story')).toHaveLength(0);
  });

  // Screen's normal header precedes children, so this uses its real header contract.
  // The home CTA and tutorial must stay above the explicit library context in both locales.
  it.each(['ja', 'en'] as const)('ホームの通常表示は%sで作成・チュートリアル・一覧・作品の順に表示する', async (locale) => {
    language = locale;
    const works = [
      { ...work, id: 'work-a', title: locale === 'ja' ? '作品A' : 'Work A' },
      { ...work, id: 'work-b', title: locale === 'ja' ? '作品B' : 'Work B' },
      { ...work, id: 'work-c', title: locale === 'ja' ? '作品C' : 'Work C' }
    ];
    await render(context(works));

    const expected = [
      t(locale, 'navigation.createManga'),
      'tutorial',
      t(locale, 'navigation.library'),
      t(locale, 'navigation.libraryHelp'),
      ...works.map((item) => item.title)
    ];
    const visibleOrder = root!.root.findByProps({ testID: 'manga-library' }).findAll((node) => (
      (node.type === 'button' && node.props.testID === 'manga-create')
      || node.type === 'tutorial'
      || (node.type === 'text' && typeof node.props.children === 'string' && expected.includes(node.props.children))
    )).map((node) => node.type === 'tutorial' ? 'tutorial' : node.type === 'button' ? node.props.label : node.props.children);

    expect(visibleOrder).toEqual(expected);
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

  it('削除受付前にdirty確認し、受付後は選択中作品を再確認なしで解除する', async () => {
    const selected = { ...work, id: 'old-work' };
    await render({ ...context([selected]), selectedWorkId: selected.id });
    await press('manga-create');
    const hierarchy = root!.root.findByType('hierarchy');

    await expect(hierarchy.props.onBeforeWorkDelete(selected.id)).resolves.toBe(true);
    expect(resolveDirtyEditors).toHaveBeenCalledWith('ja');
    await act(async () => hierarchy.props.onWorkDeletionAccepted({
      deletion_id: '11111111-1111-4111-8111-111111111111',
      work_id: selected.id,
      status: 'pending',
      blocker_code: null
    }));
    expect(updateSelection).toHaveBeenLastCalledWith(
      { workId: null, chapterId: null, episodeId: null, pageId: null, entityId: null },
      { skipDirtyCheck: true }
    );
  });

  it('別作品の削除受付では現在の選択を変更しない', async () => {
    await render(context([work]));
    await press('manga-create');
    await act(async () => root!.root.findByType('hierarchy').props.onWorkDeletionAccepted({
      deletion_id: '11111111-1111-4111-8111-111111111111',
      work_id: 'other-work',
      status: 'pending',
      blocker_code: null
    }));
    expect(updateSelection).not.toHaveBeenCalled();
  });

  it('階層を閉じていても削除状態一覧をmountする', async () => {
    await render(context([work]));
    expect(root?.root.findByType('work-deletions').props.organizationId).toBe('org');
    expect(root?.root.findByType('hierarchy').props.visible).toBe(false);
  });

});
