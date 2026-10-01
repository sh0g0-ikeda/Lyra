import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoryScreen } from '@/screens/StoryScreen';
import type { EpisodeRecord, SceneRecord } from '@/domain/types';
import { defaultSelection } from '@/lib/queryKeys';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let episode: EpisodeRecord;
let available = true;
let selection = { ...defaultSelection, workId: 'work', chapterId: 'chapter', episodeId: 'episode' };
let registration: { dirty: boolean; save: () => Promise<void>; discard: () => void };
let root: ReactTestRenderer | undefined;
const updateEpisode = vi.fn();
const getEpisodes = vi.fn();
const fetchQuery = vi.fn();
const confirmReload = vi.fn();
const entities = [{ id: 'entity', name: 'Hero', work_id: 'work' }];
const chapters = [{ id: 'chapter', work_id: 'work' }];
const works = [{ id: 'work', title: 'Manga' }];
let scenes: SceneRecord[] = [];
const updateScene = vi.fn();
const queryClient = { invalidateQueries: vi.fn(), fetchQuery, setQueryData: vi.fn((key: unknown, updater: (value: { episodes: EpisodeRecord[] }) => { episodes: EpisodeRecord[] }) => { if (Array.isArray(key) && key[0] === 'scenes') return; episode = updater({ episodes: [episode] }).episodes[0]; }) };
const query = (data: unknown): Record<string, unknown> => ({ data, isFetching: false, isSuccess: true, isError: false, error: null, refetch: vi.fn() });
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => queryClient,
  useInfiniteQuery: ({ queryKey }: { queryKey: string[] }) => ({ ...query({ pages: [queryKey[0] === 'works' ? { works } : { entities }] }), hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => query(queryKey[0] === 'chapters' ? { chapters } : queryKey[0] === 'episodes' ? { episodes: [episode] } : queryKey[0] === 'scenes' ? { scenes } : works[0]),
  useMutation: (options: { mutationFn: () => Promise<unknown>; onSuccess?: (value: unknown) => Promise<void>; onError?: (error: unknown) => void }) => {
    const run = async (): Promise<unknown> => { try { const value = await options.mutationFn(); await options.onSuccess?.(value); return value; } catch (error) { options.onError?.(error); throw error; } };
    return { mutateAsync: run, mutate: () => { void run(); }, isPending: false, error: null, reset: vi.fn() };
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
vi.mock('@/components/ActionableErrorNotice', () => ({ ActionableErrorNotice: () => null }));
vi.mock('@/lib/confirm', () => ({ confirmAction: vi.fn(), confirmDestructiveAction: vi.fn() }));
vi.mock('@/lib/confirmStaleDraftReload', () => ({ confirmStaleDraftReload: (input: unknown) => confirmReload(input) }));
vi.mock('@/lib/aiProviderDisclosure', () => ({ appendAiProviderDisclosure: (value: string) => value }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error { code = 'RESOURCE_STALE'; } }));
vi.mock('@/navigation/navigationRef', () => ({ navigationRef: { isReady: () => true, navigate: vi.fn() } }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api: { updateEpisode, getEpisodes, updateScene }, hasCapability: () => true, language: 'ja', logout: vi.fn(), selection, sessionKey: 'user', session: { capabilities: { episode_state_autofill_v1: available } } }) }));
vi.mock('@/state/dirtyState', () => ({
  useDirtyState: () => ({ resolveDirtyEditors: vi.fn().mockResolvedValue(true) }),
  useDirtyEditorRegistration: (input: typeof registration) => { registration = input; }
}));
async function render(): Promise<void> { await act(async () => { if (root) root.update(<StoryScreen />); else root = create(<StoryScreen />); }); }
async function changeStates(value: unknown): Promise<void> { await act(async () => { root?.root.findByType('starting-states').props.onChange(value); }); }
function field(label: string): { props: Record<string, (value: string) => void> } { return root!.root.findAllByType('field').find((node) => node.props.label === label)!; }

describe('Story既存保存と開始状態の統合', () => {
  beforeEach(() => {
    episode = { id: 'episode', chapter_id: 'chapter', order: 1, title: 'Title', purpose: 'hidden', story_input_mode: 'structured', story_full_draft: null, introduction: 'Intro', middle: 'Middle', climax: 'Climax', ending_hook: 'End', estimated_pages: 4, entities_involved: ['entity'], starting_entity_states: [{ entity_id: 'entity', state_id: 'saved-state' }], page_skeleton_generated: false, version: 1, status: 'draft', created_at: '', updated_at: 'revision' };
    selection = { ...defaultSelection, workId: 'work', chapterId: 'chapter', episodeId: 'episode' };
    available = true;
    scenes = [];
    updateScene.mockReset().mockImplementation(async (_id, payload) => ({ ...scenes[0], ...payload }));
    updateEpisode.mockReset().mockImplementation(async (_id, payload) => ({ ...episode, ...payload }));
    fetchQuery.mockReset().mockImplementation(async () => ({ episodes: [episode] }));
    confirmReload.mockReset();
  });
  afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });

  it('タイトルだけ編集した場合は保存済み開始状態と非表示story fieldsを送信しない', async () => {
    await render();
    await act(async () => field('タイトル').props.onChangeText('Renamed'));
    await act(async () => { await registration.save(); });
    const payload = updateEpisode.mock.calls[0][1];
    expect(payload.title).toBe('Renamed');
    expect(payload).not.toHaveProperty('starting_entity_states');
    expect(payload).not.toHaveProperty('introduction');
    expect(payload).not.toHaveProperty('entities_involved');
  });
  it('開始状態だけを明示クリアしても既存dirty保存を通り空配列を送信する', async () => {
    await render(); await changeStates([]);
    expect(registration.dirty).toBe(true);
    await act(async () => { await registration.save(); });
    expect(updateEpisode.mock.calls[0][1]).toMatchObject({ starting_entity_states: [], expected_updated_at: 'revision' });
  });
  it('破棄では開始状態を保存値へ戻し次の話へ未保存値を漏らさない', async () => {
    await render(); await changeStates([{ entity_id: 'entity', state_id: null }]);
    await act(async () => registration.discard());
    expect(root?.root.findByType('starting-states').props.value).toEqual([{ entity_id: 'entity', state_id: 'saved-state' }]);
    await changeStates([]);
    episode = { ...episode, id: 'next', starting_entity_states: undefined };
    selection.episodeId = 'next';
    await render();
    expect(root?.root.findByType('starting-states').props.value).toEqual([]);
    expect(registration.dirty).toBe(false);
  });
  it('能力OFFでも保存済み状態をread-onlyで保持する', async () => {
    available = false;
    await render();
    expect(root?.root.findByType('starting-states').props.disabled).toBe(true);
    expect(root?.root.findByType('starting-states').props.value).toEqual(episode.starting_entity_states);
  });
  it('staleの最新読込は明示確認されるまで全draftを保持する', async () => {
    const { ApiError } = await import('@/lib/api');
    updateEpisode.mockRejectedValue(new ApiError('stale', 409, 'RESOURCE_STALE'));
    await render();
    await changeStates([]);
    await act(async () => field('タイトル').props.onChangeText('Local title'));
    await act(async () => { await registration.save().catch(() => undefined); });
    const reload = root?.root.findAllByType('button').find((button) => button.props.label === '最新状態を読み込み');
    expect(reload).toBeDefined();
    await act(async () => reload?.props.onPress());
    expect(confirmReload).toHaveBeenCalledWith(expect.objectContaining({ scope: 'story', language: 'ja' }));
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(root?.root.findByType('starting-states').props.value).toEqual([]);
    await act(async () => { confirmReload.mock.calls[0][0].onConfirm(); });
    expect(fetchQuery).toHaveBeenCalledOnce();
    expect(root?.root.findByType('starting-states').props.value).toEqual(episode.starting_entity_states);
  });
  it('最新読込の確認後に話が変わった場合は古い確認でdraftを置き換えない', async () => {
    const { ApiError } = await import('@/lib/api');
    updateEpisode.mockRejectedValue(new ApiError('stale', 409, 'RESOURCE_STALE'));
    await render(); await changeStates([]);
    await act(async () => { await registration.save().catch(() => undefined); });
    await act(async () => root?.root.findAllByType('button').find((button) => button.props.label === '最新状態を読み込み')?.props.onPress());
    const oldConfirmation = confirmReload.mock.calls[0][0];
    episode = { ...episode, id: 'next', title: 'Next episode', starting_entity_states: [] };
    selection.episodeId = 'next';
    await render();
    await act(async () => oldConfirmation.onConfirm());
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(root?.root.findAllByType('field').find((node) => node.props.label === 'タイトル')?.props.value).toBe('Next episode');
  });

  it('最新読込中の追加編集を古い応答で上書きしない', async () => {
    const { ApiError } = await import('@/lib/api');
    updateEpisode.mockRejectedValue(new ApiError('stale', 409, 'RESOURCE_STALE'));
    await render(); await changeStates([]);
    await act(async () => { await registration.save().catch(() => undefined); });
    await act(async () => root?.root.findAllByType('button').find((button) => button.props.label === '最新状態を読み込み')?.props.onPress());
    let finish: (value: { episodes: EpisodeRecord[] }) => void = () => undefined;
    fetchQuery.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => confirmReload.mock.calls[0][0].onConfirm());
    await act(async () => field('タイトル').props.onChangeText('Newer local title'));
    await act(async () => finish({ episodes: [{ ...episode, title: 'Server title' }] }));
    expect(root?.root.findAllByType('field').find((node) => node.props.label === 'タイトル')?.props.value).toBe('Newer local title');
    expect(root?.root.findByType('starting-states').props.value).toEqual([]);
  });

});


describe('Storyの非表示関連と表示専用の入力help', () => {
  beforeEach(() => {
    episode = { id: 'episode', chapter_id: 'chapter', order: 1, title: 'Title', purpose: null, story_input_mode: 'full', story_full_draft: 'Saved', introduction: null, middle: null, climax: null, ending_hook: null, estimated_pages: 4, entities_involved: ['entity'], page_skeleton_generated: false, version: 1, status: 'draft', created_at: '', updated_at: 'revision' };
    selection = { ...defaultSelection, workId: 'work', chapterId: 'chapter', episodeId: 'episode' };
    available = true; scenes = []; updateScene.mockReset();
    updateEpisode.mockReset().mockImplementation(async (_id, payload) => ({ ...episode, ...payload }));
  });
  afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });
  it('sceneキャラchipsを表示せず場所だけ保存しても既存関連IDを全て保持する', async () => {
    scenes = [{id:'scene',episode_id:'episode',order:1,location:'old',time:null,atmosphere:null,involved_entity_ids:['entity','unloaded-entity'],status:'draft',created_at:'',updated_at:''}];
    updateScene.mockResolvedValue(scenes[0]);
    await render();
    await act(async () => root!.root.findAllByType('picker').find(node=>node.props.items?.[0]?.id==='scene')!.props.onSelect('scene'));
    await act(async () => field('場所').props.onChangeText('new location'));
    await act(async () => { await registration.save(); });
    expect(updateScene.mock.lastCall?.[1]).toMatchObject({location:'new location',involved_entity_ids:['entity','unloaded-entity']});
    expect(root!.root.findAllByType('button').some(node=>node.props.children==='Hero')).toBe(false);
  });
  it('例と開閉helpは保存値へ入れず既存ページ数と本文を保持する', async () => {
    scenes=[]; episode={...episode,estimated_pages:7,story_full_draft:'既存本文',story_input_mode:'full'};
    await render();
    const fields=root!.root.findAllByType('field');
    expect(fields.filter(node=>node.props.helpDisclosureLabel==='入力のヒント')).toHaveLength(7);
    expect(fields.find(node=>node.props.keyboardType==='numeric' && node.props.value==='7')).toBeDefined();
    expect(fields.find(node=>node.props.value==='既存本文')?.props.placeholder).toContain('例：');
    expect(fields.find(node=>node.props.help?.includes('今回この話から作成するページの枚数'))).toBeDefined();
    expect(fields.find(node=>node.props.help?.includes('シーンの位置'))).toBeDefined();
    expect(registration.dirty).toBe(false);
  });
});
