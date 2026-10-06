import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetsScreen } from '@/screens/AssetsScreen';
import { MangaScreen } from '@/screens/MangaScreen';
import type { EpisodeRecord } from '@/domain/types';
import { useMangaWorkflow } from '@/state/mangaWorkflow';
import { defaultSelection } from '@/lib/queryKeys';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const FocusContext = React.createContext(true);
let selection = { ...defaultSelection, workId: 'work', chapterId: 'chapter', episodeId: 'episode' };
let episode = makeEpisode();
let pages: { id: string }[] = [];
let routeParams: { step: 'story' | 'characters' | 'pages'; requestId: number } | undefined;
let hardwareBack: (() => boolean) | undefined;
let activeCharacterEditors = 0;
let maxCharacterEditors = 0;
const resolveDirtyEditors = vi.fn<() => Promise<boolean>>();
const updateSelection = vi.fn();
const navigate = vi.fn();
const getEntity = vi.fn();
let root: ReactTestRenderer | undefined;

function makeEpisode(): EpisodeRecord {
  return { id: 'episode', chapter_id: 'chapter', order: 1, title: 'Episode', purpose: null, story_input_mode: 'full', story_full_draft: '', introduction: null, middle: null, climax: null, ending_hook: null, estimated_pages: 4, entities_involved: [], page_skeleton_generated: false, version: 1, status: 'draft', created_at: '', updated_at: '' };
}

vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => React.useContext(FocusContext),
  useNavigation: () => ({ navigate }),
  useRoute: () => ({ params: routeParams })
}));
vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: () => ({ data: { pages: [{ pages }] }, isPending: false, isError: false, error: null, refetch: vi.fn() })
}));
vi.mock('react-native', () => ({
  BackHandler: { addEventListener: (_event: string, handler: () => boolean) => { hardwareBack = handler; return { remove: () => { hardwareBack = undefined; } }; } },
  Pressable: 'button', Text: 'text', View: 'view',
  StyleSheet: { create: <T,>(styles: T): T => styles }
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 34 }) }));
vi.mock('@/components/Screen', () => ({ EmbeddedScreenProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props)
}));
vi.mock('@/components/MangaLibrary', () => ({
  MangaLibrary: (props: Record<string, unknown>) => React.createElement('library', props)
}));
vi.mock('@/components/WorkspaceContextPicker', () => ({
  useWorkspaceContextSelection: () => ({ episodes: [episode], selectedEpisodeId: selection.episodeId })
}));
vi.mock('@/screens/StoryScreen', () => ({
  StoryScreen: ({ onOpenCharacters }: { onOpenCharacters: () => void }) => React.createElement('story', { onOpenCharacters })
}));
vi.mock('@/screens/CharactersScreen', () => ({
  CharactersScreen: (props: Record<string, unknown>) => {
    React.useEffect(() => {
      activeCharacterEditors += 1;
      maxCharacterEditors = Math.max(maxCharacterEditors, activeCharacterEditors);
      return () => { activeCharacterEditors -= 1; };
    }, []);
    return React.createElement('characters', props);
  }
}));
vi.mock('@/screens/PagesScreen', () => ({
  PagesScreen: () => {
    const [draft, setDraft] = React.useState('');
    const workflow = useMangaWorkflow();
    return React.createElement('pages', { draft, onChange: setDraft, onOpenCandidate: workflow?.requestStateCandidate });
  }
}));
vi.mock('@/state/appState', () => ({
  useAppState: () => ({ api: { getEntity }, language: 'ja', selection, sessionKey: 'user', updateSelection })
}));
vi.mock('@/state/dirtyState', () => ({ useDirtyState: () => ({ resolveDirtyEditors }) }));

function app(mangaFocused = true): React.JSX.Element {
  return <><FocusContext.Provider value={mangaFocused}><MangaScreen /></FocusContext.Provider><FocusContext.Provider value={!mangaFocused}><AssetsScreen /></FocusContext.Provider></>;
}
async function render(mangaFocused = true): Promise<void> {
  await act(async () => { if (root) root.update(app(mangaFocused)); else root = create(app(mangaFocused)); });
}
async function resume(): Promise<void> {
  await act(async () => { root?.root.findByType('library').props.onResume(); });
}
async function press(id: string): Promise<void> {
  await act(async () => { root?.root.findAll((node) => node.type === 'button' && node.props.testID === id)[0].props.onPress(); });
}
function activeStep(): string | undefined {
  return root?.root.findAll((node) => node.type === 'button' && node.props.accessibilityState?.selected === true)[0]?.props.testID;
}

describe('漫画制作ナビゲーション', () => {
  beforeEach(() => {
    selection = { ...defaultSelection, workId: 'work', chapterId: 'chapter', episodeId: 'episode' };
    episode = makeEpisode(); pages = []; routeParams = undefined;
    resolveDirtyEditors.mockReset().mockResolvedValue(true);
    updateSelection.mockReset().mockResolvedValue(true); navigate.mockReset();
    getEntity.mockReset().mockResolvedValue({ id: 'entity', work_id: 'work' });
    activeCharacterEditors = 0; maxCharacterEditors = 0;
  });
  afterEach(async () => { await act(async () => { root?.unmount(); }); root = undefined; });

  it('新しい話ではストーリーから始まり順に進んでもscope選択を変更しない', async () => {
    await render(); await resume();
    expect(activeStep()).toBe('manga-step-story');
    await press('manga-next');
    expect(activeStep()).toBe('manga-step-characters');
    await press('manga-next');
    expect(activeStep()).toBe('manga-step-pages');
    expect(updateSelection).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('保存済み本文があればキャラクター、保存済みページがあればページから再開する', async () => {
    episode.story_full_draft = '保存済み本文';
    await render(); await resume();
    expect(activeStep()).toBe('manga-step-characters');
    await press('manga-back-library');
    pages = [{ id: 'existing-page' }];
    await render(); await resume();
    expect(activeStep()).toBe('manga-step-pages');
  });

  it('StoryのキャラクターCTAはアセットへ離脱せず制作内の工程を開く', async () => {
    await render(); await resume();
    await act(async () => { root?.root.findByType('story').props.onOpenCharacters(); });
    expect(activeStep()).toBe('manga-step-characters');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('未保存確認をキャンセルすると元の工程とキャラクター編集を維持する', async () => {
    episode.story_full_draft = '保存済み本文';
    await render(); await resume();
    resolveDirtyEditors.mockResolvedValue(false);
    await press('manga-step-pages');
    expect(activeStep()).toBe('manga-step-characters');
    expect(activeCharacterEditors).toBe(1);
    await press('manga-back-library');
    expect(activeStep()).toBe('manga-step-characters');
  });

  it('ページeditorは非表示時に読み上げず、mocked draftの保持は実dirty guardを検証しない', async () => {
    pages = [{ id: 'page' }];
    await render(); await resume();
    await act(async () => { root?.root.findByType('pages').props.onChange('未保存のページ入力'); });
    await press('manga-step-story');
    const hiddenPage = root?.root.findByProps({ testID: 'manga-pages-editor' });
    expect(hiddenPage?.props.style).toEqual({ display: 'none' });
    expect(hiddenPage?.props.accessibilityElementsHidden).toBe(true);
    expect(hiddenPage?.props.importantForAccessibility).toBe('no-hide-descendants');
    await press('manga-back-library'); await resume();
    expect(root?.root.findByType('pages').props.draft).toBe('未保存のページ入力');
    const hiddenStory = root?.root.findByProps({ testID: 'manga-story-editor' });
    expect(hiddenStory?.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('漫画内キャラクターとアセットは同時に同じdirty editorを登録しない', async () => {
    episode.story_full_draft = '本文';
    await render(); await resume();
    expect(activeCharacterEditors).toBe(1);
    await render(false);
    expect(activeCharacterEditors).toBe(1);
    await render(true);
    expect(activeCharacterEditors).toBe(1);
    expect(maxCharacterEditors).toBe(1);
  });

  it('未保存確認中にscopeが変わった場合は古い工程へ移動しない', async () => {
    await render(); await resume();
    let finish: (value: boolean) => void = () => undefined;
    resolveDirtyEditors.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await press('manga-step-pages');
    selection = { ...selection, organizationId: 'other-org', episodeId: 'other-episode' };
    await render();
    await act(async () => { finish(true); });
    expect(root?.root.findAllByType('library')).toHaveLength(1);
    expect(activeStep()).toBeUndefined();
    expect(updateSelection).not.toHaveBeenCalled();
  });

  it('連続した工程移動は最後の要求だけを適用する', async () => {
    await render(); await resume();
    const finish: ((value: boolean) => void)[] = [];
    resolveDirtyEditors.mockImplementation(() => new Promise((resolve) => { finish.push(resolve); }));
    await press('manga-step-characters'); await press('manga-step-pages');
    await act(async () => { finish[1](true); finish[0](true); });
    expect(activeStep()).toBe('manga-step-pages');
  });

  it('戻る操作にも未保存確認を適用する', async () => {
    pages = [{ id: 'page' }];
    await render(); await resume();
    resolveDirtyEditors.mockResolvedValue(false);
    await act(async () => { expect(hardwareBack?.()).toBe(true); });
    expect(activeStep()).toBe('manga-step-pages');
    resolveDirtyEditors.mockResolvedValue(true);
    await act(async () => { hardwareBack?.(); });
    expect(activeStep()).toBe('manga-step-characters');
  });

  it('ガイドや通知の明示的なページ要求を受け付け古い要求を別scopeで再実行しない', async () => {
    routeParams = { step: 'pages', requestId: 1 };
    await render();
    expect(activeStep()).toBe('manga-step-pages');
    selection = { ...selection, workId: 'other-work' };
    await render();
    expect(activeStep()).toBeUndefined();
    routeParams = { step: 'story', requestId: 2 };
    await render();
    expect(activeStep()).toBe('manga-step-story');
  });
  it('確認待ち中に現在工程を選び直すと保留していた移動を取り消す', async () => {
    await render(); await resume();
    let finish: (value: boolean) => void = () => undefined;
    resolveDirtyEditors.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await press('manga-step-characters'); await press('manga-step-story');
    await act(async () => { finish(true); });
    expect(activeStep()).toBe('manga-step-story');
  });

  it('未保存確認中にタブが変わった場合は移動先から元工程を開き直さない', async () => {
    await render(); await resume();
    let finish: (value: boolean) => void = () => undefined;
    resolveDirtyEditors.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await press('manga-step-pages');
    await render(false);
    await act(async () => { finish(true); });
    await render(true);
    expect(activeStep()).toBe('manga-step-story');
  });

  it('不足状態の候補は同workの人物を検証して制作内へ渡し明示returnでページへ戻す', async () => {
    pages = [{ id: 'page' }];
    await render(); await resume();
    const candidate = { entityId: 'entity', name: '外傷', description: '右腕の傷', stateId: null };
    await act(async () => { expect(await root?.root.findByType('pages').props.onOpenCandidate(candidate)).toBe(true); });
    expect(getEntity).toHaveBeenCalledWith('entity', null);
    expect(updateSelection).toHaveBeenCalledWith({ entityId: 'entity' });
    expect(activeStep()).toBe('manga-step-characters');
    expect(root?.root.findByType('characters').props.initialStateCandidate).toEqual(candidate);
    await act(async () => root?.root.findByType('characters').props.onReturnToPages());
    expect(activeStep()).toBe('manga-step-pages');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('候補移動をキャンセルした場合や別work人物の場合は選択を変更しない', async () => {
    pages = [{ id: 'page' }];
    await render(); await resume();
    resolveDirtyEditors.mockResolvedValue(false);
    const candidate = { entityId: 'entity', name: '外傷', description: '傷' };
    await act(async () => { expect(await root?.root.findByType('pages').props.onOpenCandidate(candidate)).toBe(false); });
    expect(getEntity).not.toHaveBeenCalled();
    resolveDirtyEditors.mockResolvedValue(true);
    getEntity.mockResolvedValue({ id: 'entity', work_id: 'foreign' });
    await act(async () => { await expect(root?.root.findByType('pages').props.onOpenCandidate(candidate)).rejects.toThrow('not available'); });
    expect(updateSelection).not.toHaveBeenCalled();
    expect(activeStep()).toBe('manga-step-pages');
  });

});
