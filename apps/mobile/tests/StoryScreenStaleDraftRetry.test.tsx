import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryScreen } from '@/screens/StoryScreen';
import type { EpisodeRecord } from '@/domain/types';
import { defaultSelection, episodesQueryKey } from '@/lib/queryKeys';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let episode: EpisodeRecord;
let selection = { ...defaultSelection, workId: 'work', chapterId: 'chapter', episodeId: 'episode' };
let sessionKey = 'user';
let registration: { save: () => Promise<void> };
let root: ReactTestRenderer | undefined;
const updateEpisode = vi.fn();
const getEpisodes = vi.fn();
const fetchQuery = vi.fn();
const confirmReload = vi.fn();
const queryClient = {
  fetchQuery,
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn()
};

const query = (data: unknown): Record<string, unknown> => ({ data, isFetching: false, isSuccess: true, isError: false, error: null, refetch: vi.fn() });
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => queryClient,
  useInfiniteQuery: ({ queryKey }: { queryKey: string[] }) => ({ ...query({ pages: [queryKey[0] === 'works' ? { works: [{ id: 'work', title: 'Work' }] } : { entities: [{ id: 'entity', name: 'Hero', work_id: 'work' }] }] }), hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => query(queryKey[0] === 'chapters' ? { chapters: [{ id: 'chapter', work_id: 'work' }] } : queryKey[0] === 'episodes' ? { episodes: [episode] } : queryKey[0] === 'scenes' ? { scenes: [] } : { id: 'work', title: 'Work' }),
  useMutation: (options: { mutationFn: () => Promise<unknown>; onSuccess?: (value: unknown) => Promise<void>; onError?: (error: unknown) => void }) => {
    const [error, setError] = React.useState<unknown>(null);
    const run = async (): Promise<unknown> => {
      try { const value = await options.mutationFn(); setError(null); await options.onSuccess?.(value); return value; }
      catch (failure) { setError(failure); options.onError?.(failure); throw failure; }
    };
    return { mutateAsync: run, mutate: () => { void run(); }, isPending: false, error, reset: () => setError(null) };
  }
}));
vi.mock('react-native', () => ({ Pressable: 'button', Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/Section', () => ({ Section: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/components/FormField', () => ({ FormField: (props: Record<string, unknown>) => React.createElement('field', props) }));
vi.mock('@/components/EpisodeStartingStatesEditor', () => ({ EpisodeStartingStatesEditor: (props: Record<string, unknown>) => React.createElement('starting-states', props) }));
vi.mock('@/components/RecordPicker', () => ({ RecordPicker: (props: Record<string, unknown>) => React.createElement('picker', props) }));
vi.mock('@/components/EpisodeImprovementPanel', () => ({ EpisodeImprovementPanel: () => null }));
vi.mock('@/components/StoryCollaborationPanel', () => ({ StoryCollaborationPanel: () => null }));
vi.mock('@/components/WorkspaceHierarchyNavigator', () => ({ WorkspaceHierarchyNavigator: () => null }));
vi.mock('@/components/WorkspaceContextPicker', () => ({ useWorkspaceContextSelection: () => ({}) }));
vi.mock('@/components/Notice', () => ({ Notice: () => null }));
vi.mock('@/components/ActionableErrorNotice', () => ({ ActionableErrorNotice: (props: Record<string, unknown>) => React.createElement('error-notice', props) }));
vi.mock('@/lib/confirm', () => ({ confirmAction: vi.fn(), confirmDestructiveAction: vi.fn() }));
vi.mock('@/lib/confirmStaleDraftReload', () => ({ confirmStaleDraftReload: (input: unknown) => confirmReload(input) }));
vi.mock('@/lib/aiProviderDisclosure', () => ({ appendAiProviderDisclosure: (value: string) => value }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error { code = 'RESOURCE_STALE'; } }));
vi.mock('@/navigation/navigationRef', () => ({ navigationRef: { isReady: () => true, navigate: vi.fn() } }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api: { updateEpisode, getEpisodes, updateScene: vi.fn() }, hasCapability: () => true, language: 'ja', logout: vi.fn(), selection, sessionKey, session: { capabilities: { episode_state_autofill_v1: true } } }) }));
vi.mock('@/state/dirtyState', () => ({ useDirtyState: () => ({ resolveDirtyEditors: vi.fn().mockResolvedValue(true) }), useDirtyEditorRegistration: (input: typeof registration) => { registration = input; } }));

async function render(): Promise<void> { await act(async () => { if (root) root.update(<StoryScreen />); else root = create(<StoryScreen />); }); }
function field(label: string): ReactTestRenderer['root'] { return root!.root.findAllByType('field').find((node) => node.props.label === label)!; }
function body(): ReactTestRenderer['root'] { return root!.root.findAllByType('field').find((node) => node.props.maxLength === 8000)!; }
function retry(): ReactTestRenderer['root'] { return root!.root.findAllByType('button').find((node) => node.props.label === '現在の入力で再試行')!; }
function reload(): ReactTestRenderer['root'] { return root!.root.findAllByType('button').find((node) => node.props.label === '最新状態を読み込み')!; }
async function makeStale(): Promise<void> {
  const { ApiError } = await import('@/lib/api');
  updateEpisode.mockRejectedValueOnce(new ApiError('stale', 409, 'RESOURCE_STALE'));
  await act(async () => { await registration.save().catch(() => undefined); });
  expect(retry()).toBeDefined();
  updateEpisode.mockClear();
}

describe('Story stale draft retry', () => {
  beforeEach(() => {
    episode = { id: 'episode', chapter_id: 'chapter', order: 1, title: 'Saved', purpose: null, story_input_mode: 'full', story_full_draft: 'Saved story', introduction: null, middle: null, climax: null, ending_hook: null, estimated_pages: 4, entities_involved: ['entity'], starting_entity_states: [{ entity_id: 'entity', state_id: 'saved-state' }], page_skeleton_generated: false, version: 1, status: 'draft', created_at: '', updated_at: 'cached-revision' };
    selection = { ...defaultSelection, workId: 'work', chapterId: 'chapter', episodeId: 'episode' };
    sessionKey = 'user';
    updateEpisode.mockReset().mockResolvedValue(episode);
    getEpisodes.mockReset();
    fetchQuery.mockReset().mockResolvedValue({ episodes: [episode] });
    confirmReload.mockReset();
    queryClient.invalidateQueries.mockReset();
  });
  afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });

  it('新しい版を読んで現在のtitle本文開始状態を一度だけCAS保存する', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Local title'));
    await act(async () => body().props.onChangeText('Local story'));
    await act(async () => root!.root.findByType('starting-states').props.onChange([]));
    await makeStale();
    let resolveRead!: (value: { episodes: EpisodeRecord[] }) => void;
    fetchQuery.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    await act(async () => { retry().props.onPress(); retry().props.onPress(); });
    expect(fetchQuery).toHaveBeenCalledOnce();
    await act(async () => resolveRead({ episodes: [{ ...episode, version: 2, updated_at: 'fresh-revision' }] }));
    expect(updateEpisode).toHaveBeenCalledOnce();
    expect(updateEpisode).toHaveBeenCalledWith('episode', expect.objectContaining({ title: 'Local title', story_full_draft: 'Local story', starting_entity_states: [], expected_updated_at: 'fresh-revision' }), null);
    expect(field('タイトル').props.value).toBe('Local title');
    expect(body().props.value).toBe('Local story');
    expect(root!.root.findByType('starting-states').props.value).toEqual([]);
  });

  it('retry時の409は入力と再試行操作を保持する', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Local title'));
    await makeStale();
    fetchQuery.mockResolvedValue({ episodes: [{ ...episode, updated_at: 'fresh-revision' }] });
    const { ApiError } = await import('@/lib/api');
    updateEpisode.mockRejectedValueOnce(new ApiError('stale again', 409, 'RESOURCE_STALE'));
    await act(async () => { retry().props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    expect(updateEpisode).toHaveBeenCalledOnce();
    expect(field('タイトル').props.value).toBe('Local title');
    expect(retry()).toBeDefined();
    expect(root!.root.findAllByType('error-notice')).toHaveLength(1);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(updateEpisode).toHaveBeenCalledOnce();
  });

  it('同じ話で読込中にlocal titleが変われば古いdraftを保存しない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Old local title'));
    await makeStale();
    let resolveRead!: (value: { episodes: EpisodeRecord[] }) => void;
    fetchQuery.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    await act(async () => retry().props.onPress());
    await act(async () => field('タイトル').props.onChangeText('New local title'));
    await act(async () => resolveRead({ episodes: [{ ...episode, updated_at: 'fresh-revision' }] }));
    expect(updateEpisode).not.toHaveBeenCalled();
    expect(field('タイトル').props.value).toBe('New local title');
  });

  it('読込中に選択が変われば古い応答で保存しない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Old local title'));
    await makeStale();
    let resolveRead!: (value: { episodes: EpisodeRecord[] }) => void;
    fetchQuery.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    await act(async () => retry().props.onPress());
    episode = { ...episode, id: 'next', title: 'Next saved' };
    selection = { ...selection, episodeId: 'next' };
    await render();
    await act(async () => resolveRead({ episodes: [{ ...episode, id: 'episode', updated_at: 'fresh-revision' }] }));
    expect(updateEpisode).not.toHaveBeenCalled();
  });

  it('読込中にsession又はorganization scopeが変われば古い応答で保存しない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Old local title'));
    await makeStale();
    let resolveRead!: (value: { episodes: EpisodeRecord[] }) => void;
    fetchQuery.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    await act(async () => retry().props.onPress());
    sessionKey = 'other-user';
    selection = { ...selection, organizationId: 'other-org' };
    await render();
    await act(async () => resolveRead({ episodes: [{ ...episode, updated_at: 'fresh-revision' }] }));
    expect(updateEpisode).not.toHaveBeenCalled();
  });

  it('無期限stale cacheではなくAPIから読んだ最新revisionで保存する', async () => {
    const { QueryClient } = await import('@tanstack/query-core');
    const realClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const queryKey = episodesQueryKey(sessionKey, 'chapter', selection.organizationId);
    realClient.setQueryData(queryKey, { episodes: [episode] });
    const latest = { ...episode, version: 2, updated_at: 'fresh-revision' };
    getEpisodes.mockResolvedValue({ episodes: [latest] });
    fetchQuery.mockImplementation((input: Parameters<QueryClient['fetchQuery']>[0]) => realClient.fetchQuery(input));
    await render();
    await act(async () => field('タイトル').props.onChangeText('Local title'));
    await makeStale();
    await act(async () => { retry().props.onPress(); await Promise.resolve(); await Promise.resolve(); });
    expect(getEpisodes).toHaveBeenCalledOnce();
    expect(updateEpisode).toHaveBeenCalledWith('episode', expect.objectContaining({ expected_updated_at: 'fresh-revision' }), null);
    realClient.clear();
  });

  it('retry読込中のreload確認は二重読込を開始しない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Local title'));
    await makeStale();
    let resolveRead!: (value: { episodes: EpisodeRecord[] }) => void;
    fetchQuery.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    await act(async () => retry().props.onPress());
    await act(async () => reload().props.onPress());
    await act(async () => { confirmReload.mock.calls[0][0].onConfirm(); });
    expect(fetchQuery).toHaveBeenCalledOnce();
    await act(async () => resolveRead({ episodes: [{ ...episode, updated_at: 'fresh-revision' }] }));
  });

  it('retry読込中のdirty saveは古いrevisionで保存しない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Local title'));
    await makeStale();
    let resolveRead!: (value: { episodes: EpisodeRecord[] }) => void;
    fetchQuery.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    await act(async () => retry().props.onPress());
    await act(async () => { void registration.save().catch(() => undefined); await Promise.resolve(); });
    expect(updateEpisode).not.toHaveBeenCalled();
    await act(async () => resolveRead({ episodes: [{ ...episode, updated_at: 'fresh-revision' }] }));
    expect(root!.root.findAllByType('error-notice')).toHaveLength(0);
  });

  it('読込中に開始状態を変更した場合は旧状態を保存しない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Local title'));
    await makeStale();
    let resolveRead!: (value: { episodes: EpisodeRecord[] }) => void;
    fetchQuery.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    await act(async () => retry().props.onPress());
    await act(async () => root!.root.findByType('starting-states').props.onChange([]));
    await act(async () => resolveRead({ episodes: [{ ...episode, updated_at: 'fresh-revision' }] }));
    expect(updateEpisode).not.toHaveBeenCalled();
    expect(root!.root.findByType('starting-states').props.value).toEqual([]);
  });

  it('保存中の追加編集は保存応答で消えず二重保存もしない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Submitted title'));
    await makeStale();
    fetchQuery.mockResolvedValue({ episodes: [{ ...episode, updated_at: 'fresh-revision' }] });
    let resolveSave!: (value: EpisodeRecord) => void;
    updateEpisode.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    await act(async () => { retry().props.onPress(); await Promise.resolve(); });
    expect(updateEpisode).toHaveBeenCalledOnce();
    await act(async () => field('タイトル').props.onChangeText('Newer title'));
    await act(async () => retry().props.onPress());
    const saved = { ...episode, title: 'Submitted title', updated_at: 'saved-revision' };
    await act(async () => { episode = saved; resolveSave(saved); });
    await render();
    expect(updateEpisode).toHaveBeenCalledOnce();
    expect(field('タイトル').props.value).toBe('Newer title');
  });

  it('最新応答の話が別章に属する場合は別リソースへ保存しない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Local title'));
    await makeStale();
    fetchQuery.mockResolvedValue({ episodes: [{ ...episode, chapter_id: 'other-chapter', updated_at: 'fresh-revision' }] });
    await act(async () => { retry().props.onPress(); await Promise.resolve(); });
    expect(updateEpisode).not.toHaveBeenCalled();
    expect(field('タイトル').props.value).toBe('Local title');
    expect(retry()).toBeDefined();
  });

  it('最新話が無い又は読込失敗なら保存しない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Local title'));
    await makeStale();
    fetchQuery.mockResolvedValueOnce({ episodes: [] });
    await act(async () => { retry().props.onPress(); await Promise.resolve(); });
    expect(updateEpisode).not.toHaveBeenCalled();
    expect(retry()).toBeDefined();
    fetchQuery.mockRejectedValueOnce(new Error('read failed'));
    await act(async () => { retry().props.onPress(); await Promise.resolve(); });
    expect(updateEpisode).not.toHaveBeenCalled();
    expect(retry()).toBeDefined();
  });
});
