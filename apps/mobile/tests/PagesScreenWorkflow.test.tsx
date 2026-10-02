import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelDialogueEditor } from '@/components/PanelDialogueEditor';
import { PagesScreen } from '@/screens/PagesScreen';
import type { PageRecord, PanelFrameRecord, PanelRecord, EntityRecord } from '@/domain/types';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const page: PageRecord = { id: 'page', episode_id: 'episode', page_number: 1, layout_config: {}, story_source_scene_ids: [], story_page_purpose: null, story_continuity_note: null, dialogue_mode: 'image_baked', page_dialogue_toggle: true, generation_mode: null, generated_image: null, status: 'designing', panel_count: 1, frame_count: 1, balloon_count: 0, created_at: '', updated_at: 'revision' };
const panels: PanelRecord[] = [{ id: 'panel', page_id: 'page', order: 1, panel_role: 'action', panel_size: 'standard', situation_text: null, composition: { composition_prompt: null, shot_type: null, angle: null, custom_note: null }, entities: [], dialogue_in_panel: true, dialogue: [], sfx_text: null, background_note: null, panel_notes: null, created_at: '', updated_at: '' }];
const frames: PanelFrameRecord[] = [{ id: 'frame', page_id: 'page', panel_id: 'panel', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], border_style: 'solid', border_width: 1, border_color: '#000000', z_index: 1, reading_order: 1 }];
const queryData = { pages: { pages: [{ pages: [page] }], pageParams: [null] }, entities: { pages: [{ entities: [] as EntityRecord[] }], pageParams: [null] }, panels: { panels }, frames: { frames }, scenes: { scenes: [] }, readiness: { ready: true, blockers: [], warnings: [], estimated_credit_cost: 8, page_revision: 'revision' }, templates: { templates: [] } };
let moreEntities = false;
const { action, dirtyRegistration, quoteOpen, fetchEntities, openUrl } = vi.hoisted(() => ({ action: vi.fn(), dirtyRegistration: vi.fn(), quoteOpen: vi.fn(), fetchEntities: vi.fn(), openUrl: vi.fn().mockResolvedValue(undefined) })); const api = { updatePage: action, updatePanel: action, generatePage: action, autofillEpisodePagesFromStory: action };
let root: ReactTestRenderer | undefined;
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: action }), useIsFocused: () => true }));
vi.mock('react-native', () => ({ Keyboard: { dismiss: vi.fn() }, Linking: { openURL: openUrl }, Modal: 'modal', Pressable: 'button', ScrollView: 'scroll', Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('expo-image', () => ({ Image: { prefetch: vi.fn().mockResolvedValue(true) } }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  useInfiniteQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === 'pages' ? queryData.pages : queryData.entities, isSuccess: true, isFetching: false, hasNextPage: queryKey[0] === 'pages' ? false : moreEntities, isFetchingNextPage: false, fetchNextPage: fetchEntities, error: null }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === 'panels' ? queryData.panels : queryKey[0] === 'frames' ? queryData.frames : queryKey[0] === 'scenes' ? queryData.scenes : queryKey[0] === 'page-generation-readiness' ? queryData.readiness : queryKey[0] === 'page-layout-templates' ? queryData.templates : undefined, isSuccess: true, isFetching: false, isLoading: false, error: null, refetch: vi.fn() }),
  useMutation: (options: { mutationFn: (...args: unknown[]) => Promise<unknown>; onSuccess?: (value: unknown) => Promise<void> }) => {
    const [error, setError] = React.useState<unknown>(null);
    const run = async (...args: unknown[]): Promise<unknown> => {
      try { const value = await options.mutationFn(...args); await options.onSuccess?.(value); setError(null); return value; }
      catch (cause) { setError(cause); throw cause; }
    };
    return { mutate: (...args: unknown[]) => { void run(...args).catch(() => undefined); }, mutateAsync: run, isPending: false, error, reset: () => setError(null) };
  }
}));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api, hasCapability: () => true, language: 'ja', logout: action, selection: { organizationId: null, workId: 'work', chapterId: 'chapter', episodeId: 'episode', pageId: 'page', entityId: null }, session: { capabilities: { generation_quotes: true } }, sessionKey: 'user', tokens: null, trackJob: action, updateSelection: action }) }));
vi.mock('@/state/dirtyState', () => ({ useDirtyEditorRegistration: dirtyRegistration, useDirtyState: () => ({ resolveDirtyEditors: vi.fn().mockResolvedValue(true), hasDirtyEditors: false }) }));
vi.mock('@/state/mangaWorkflow', () => ({ useMangaWorkflow: () => ({ activeStep: 'pages' }) }));
vi.mock('@/hooks/usePageGenerationQuote', () => ({ usePageGenerationQuote: () => ({ state: { phase: 'closed', visible: false, target: null, quote: null }, controller: { open: quoteOpen, close: vi.fn(), accept: vi.fn(), reconcile: vi.fn(), canAccept: () => false } }) }));
vi.mock('@/hooks/usePageCompletion', () => ({ usePageCompletion: () => ({ result: null, visible: false, complete: vi.fn(), open: vi.fn(), close: vi.fn() }) }));
vi.mock('@/lib/confirmationPresentation', () => ({ useConfirmationPresentation: () => false }));
vi.mock('@/hooks/useActiveResourceJobId', () => ({ useActiveResourceJobId: () => null }));
vi.mock('@/hooks/usePanelInsertion', () => ({ usePanelInsertion: () => ({ blocker: null, operationActive: false, notice: null, insertAfter: vi.fn(), reload: vi.fn() }) }));
vi.mock('@/hooks/useResetOnScopeChange', () => ({ useResetOnScopeChange: vi.fn() }));
vi.mock('@/lib/confirm', () => ({ confirmAction: action, confirmDestructiveAction: action }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/config', () => ({ config: { apiBaseUrl: 'https://example.test', webEditorUrl: 'https://d2dw83tkmziksr.cloudfront.net/', episodeExportEnabled: false } }));
vi.mock('@/lib/download', () => ({ appendOrganizationQuery: vi.fn(), downloadAuthenticatedFile: action }));
vi.mock('@/components/WorkspaceContextPicker', () => ({ useWorkspaceContextSelection: () => ({ selectedWorkId: 'work', selectedEpisodeId: 'episode' }) }));
vi.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/Section', () => ({ Section: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/FormField', () => ({ FormField: (props: Record<string, unknown>) => React.createElement('field', props) }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: (props: Record<string, unknown>) => React.createElement('button', props) }));
vi.mock('@/components/RecordPicker', () => ({ RecordPicker: (props: Record<string, unknown>) => React.createElement('picker', props) }));
vi.mock('@/components/PageErrorRecoveryNotice', () => ({ PageErrorRecoveryNotice: (props: Record<string, unknown>) => React.createElement('PageErrorRecoveryNotice', props) }));
vi.mock('@/components/ExportJobCard', () => ({ ExportJobCard: (props: Record<string, unknown>) => React.createElement('ExportJobCard', props) }));
vi.mock('@/components/ExcessPanelDeletionPlan', () => ({ ExcessPanelDeletionPlan: (props: Record<string, unknown>) => React.createElement('ExcessPanelDeletionPlan', props) }));
vi.mock('@/components/ConfirmedPageSummary', () => ({ ConfirmedPageSummary: (props: Record<string, unknown>) => React.createElement('ConfirmedPageSummary', props) }));
vi.mock('@/components/ImagePreviewModal', () => ({ ImagePreviewModal: (props: Record<string, unknown>) => React.createElement('ImagePreviewModal', props) }));
vi.mock('@/components/JobStatusCard', () => ({ JobStatusCard: (props: Record<string, unknown>) => React.createElement('JobStatusCard', props) }));
vi.mock('@/components/LayoutTemplatePreview', () => ({ LayoutTemplatePreview: (props: Record<string, unknown>) => React.createElement('LayoutTemplatePreview', props) }));
vi.mock('@/components/Notice', () => ({ Notice: (props: Record<string, unknown>) => React.createElement('Notice', props) }));
vi.mock('@/components/PageGenerationQuoteDialog', () => ({ PageGenerationQuoteDialog: (props: Record<string, unknown>) => React.createElement('PageGenerationQuoteDialog', props) }));
vi.mock('@/components/PageGenerationResultModal', () => ({ PageGenerationResultModal: (props: Record<string, unknown>) => React.createElement('PageGenerationResultModal', props) }));
vi.mock('@/components/PageGenerationActions', () => ({ PageGenerationActions: (props: Record<string, unknown>) => React.createElement('PageGenerationActions', props) }));
vi.mock('@/components/PageImageViewer', () => ({ PageImageViewer: (props: Record<string, unknown>) => React.createElement('PageImageViewer', props) }));
vi.mock('@/components/PageSceneAutofillAction', () => ({ PageSceneAutofillAction: (props: Record<string, unknown>) => React.createElement('PageSceneAutofillAction', props) }));
vi.mock('@/components/PageThumbnailPicker', () => ({ PageThumbnailPicker: (props: Record<string, unknown>) => React.createElement('PageThumbnailPicker', props) }));
vi.mock('@/components/PageProvenanceFields', () => ({ PageProvenanceFields: (props: Record<string, unknown>) => React.createElement('PageProvenanceFields', props) }));
vi.mock('@/components/PanelDialoguePlacementNotice', () => ({ PanelDialoguePlacementNotice: (props: Record<string, unknown>) => React.createElement('PanelDialoguePlacementNotice', props) }));
vi.mock('@/components/PanelDialogueEditor', () => ({ PanelDialogueEditor: (props: Record<string, unknown>) => React.createElement('PanelDialogueEditor', props) }));
vi.mock('@/components/EntityStatePicker', () => ({ EntityStatePicker: (props: Record<string, unknown>) => React.createElement('EntityStatePicker', props) }));
vi.mock('@/components/PanelEditorSections', () => ({ PanelEditorSections: (props: Record<string, unknown>) => React.createElement('PanelEditorSections', props) }));
vi.mock('@/components/PanelOrderList', () => ({ PanelOrderList: (props: Record<string, unknown>) => React.createElement('PanelOrderList', props) }));
vi.mock('@/components/SegmentedControl', () => ({ SegmentedControl: (props: Record<string, unknown>) => React.createElement('SegmentedControl', props) }));
vi.mock('@/components/EpisodeStateAutofillResult', () => ({ EpisodeStateAutofillResult: (props: Record<string, unknown>) => React.createElement('EpisodeStateAutofillResult', props) }));
vi.mock('@/components/StoryStateAutofillOptions', () => ({ StoryStateAutofillOptions: (props: Record<string, unknown>) => React.createElement('StoryStateAutofillOptions', props) }));
vi.mock('@/components/StoryGenerationControls', () => ({ StoryGenerationControls: (props: Record<string, unknown>) => React.createElement('StoryGenerationControls', props) }));
vi.mock('@/components/WorkspaceHierarchyNavigator', () => ({ WorkspaceHierarchyNavigator: (props: Record<string, unknown>) => React.createElement('WorkspaceHierarchyNavigator', props) }));

beforeEach(() => { action.mockReset(); dirtyRegistration.mockReset(); quoteOpen.mockReset(); fetchEntities.mockReset(); openUrl.mockReset(); openUrl.mockResolvedValue(undefined); moreEntities=false; page.layout_config={}; queryData.entities.pages=[{entities:[]}]; panels[0].entities=[]; panels[0].dialogue=[]; });
afterEach(async () => { await act(async () => root?.unmount()); });
describe('実際のPagesScreenの工程構成', () => {
  it('Web editor操作は設定済みのstaging originを開く', async () => {
    await act(async () => { root = create(<PagesScreen />); });
    await act(async () => {
      root!.root.findByType('PanelOrderList').props.onSelect('panel');
      await Promise.resolve();
    });
    const dialogue = root!.root.findByType('PanelEditorSections').props.sections.dialogue;
    const notice = React.Children.toArray(dialogue.props.children).find(
      (child) => React.isValidElement(child) && typeof (child.props as { onOpenWeb?: unknown }).onOpenWeb === 'function',
    ) as React.ReactElement<{ onOpenWeb: () => void }>;

    await act(async () => { notice.props.onOpenWeb(); });

    expect(openUrl).toHaveBeenCalledWith('https://d2dw83tkmziksr.cloudfront.net/');
  });

  it('ページ保存失敗の処理名と保持範囲を保ちrefreshで保存を再送信しない', async () => {
    action.mockRejectedValue(new Error('server detail'));
    await act(async () => { root = create(<PagesScreen />); });
    const style = (): ReactTestRenderer['root'] => root!.root.findAllByType('field').find(node => node.props.label === '参考にしたい作品・画風')!;
    await act(async () => style().props.onChangeText('保持する画風'));
    await act(async () => root!.root.findAllByType('button').find(node => node.props.label === '保存')!.props.onPress());
    const notice = root!.root.findByType('PageErrorRecoveryNotice');
    expect(notice.props.context).toEqual({ operation: 'savePage', retainedDraft: 'page' });
    expect(style().props.value).toBe('保持する画風');
    await act(async () => notice.props.onRetry());
    expect(action).toHaveBeenCalledOnce();
    expect(style().props.value).toBe('保持する画風');
  });
  it('ステップ変更で保存やAIを呼ばずページ入力を保持し実コマ設定をpreviewに使う', async () => {
    await act(async () => { root = create(<PagesScreen />); });
    const style = (): ReactTestRenderer['root'] => root!.root.findAllByType('field').find((node) => node.props.label === '参考にしたい作品・画風')!;
    await act(async () => style().props.onChangeText('保持する入力'));
    for (const step of ['design', 'settings', 'create', 'settings']) {
      await act(async () => root!.root.findByProps({ testID: `page-step-${step}` }).props.onPress());
    }
    expect(style().props.value).toBe('保持する入力');
    expect(action).not.toHaveBeenCalled(); expect(quoteOpen).not.toHaveBeenCalled();
    expect(root!.root.findAllByProps({ testID: 'page-settings-preview' })).toHaveLength(2);
    expect(root!.root.findByType('LayoutTemplatePreview').props.frames).toHaveLength(1);
    expect(root!.root.findByType('LayoutTemplatePreview').props.frames[0].vertices).toEqual(frames[0].vertices);
  });
  it('未保存のページ入力はページ・work・episode切替を止めるdirty editorとして登録する', async () => {
    await act(async () => { root = create(<PagesScreen />); });
    const style = (): ReactTestRenderer['root'] => root!.root.findAllByType('field').find((node) => node.props.label === '参考にしたい作品・画風')!;
    await act(async () => style().props.onChangeText('切替前に保存する入力'));
    const registration = dirtyRegistration.mock.lastCall?.[0];
    expect(registration).toMatchObject({
      id: 'pages-editor',
      dirty: true,
      blocksNavigation: true
    });
    expect(typeof registration?.save).toBe('function');
    expect(typeof registration?.discard).toBe('function');
  });
  it('遷移前にページdraftを保存すると保存済み値へ同期してdirtyを解消する', async () => {
    action.mockImplementation(async (_pageId: string, payload: { style_reference: { title: string; notes: string | null } | null }) => {
      page.layout_config = payload.style_reference === null ? {} : { style_reference: payload.style_reference };
      return page;
    });
    await act(async () => { root = create(<PagesScreen />); });
    const style = (): ReactTestRenderer['root'] => root!.root.findAllByType('field').find((node) => node.props.label === '参考にしたい作品・画風')!;
    await act(async () => style().props.onChangeText('保存して切り替える画風'));
    await act(async () => { await dirtyRegistration.mock.lastCall?.[0].save(); });
    expect(action).toHaveBeenCalledWith('page', expect.objectContaining({
      style_reference: { title: '保存して切り替える画風', notes: null }
    }), null);
    await act(async () => { root?.update(<PagesScreen />); });
    expect(style().props.value).toBe('保存して切り替える画風');
    expect(dirtyRegistration.mock.lastCall?.[0]).toMatchObject({ id: 'pages-editor', dirty: false });
  });
  it('遷移前にページdraftを破棄すると保存済み値へ戻しAPIを呼ばない', async () => {
    await act(async () => { root = create(<PagesScreen />); });
    const style = (): ReactTestRenderer['root'] => root!.root.findAllByType('field').find((node) => node.props.label === '参考にしたい作品・画風')!;
    await act(async () => style().props.onChangeText('破棄する画風'));
    await act(async () => { dirtyRegistration.mock.lastCall?.[0].discard(); });
    expect(style().props.value).toBe('');
    expect(action).not.toHaveBeenCalled();
  });
  it('工程別CTAを分離しpage number選択とcolor/monochrome入口を維持する', async () => {
    await act(async () => { root = create(<PagesScreen />); });
    expect(root!.root.findAllByType('StoryGenerationControls').map((node) => node.props.visibleAction)).toEqual(['skeleton', 'autofill']);
    const picker = root!.root.findAllByType('picker').find((node) => node.props.items?.some((item: { id: string }) => item.id === 'page'));
    expect(picker?.props.labelForItem(page)).toBe('1ページ');
    const generation = root!.root.findByType('PageGenerationActions');
    await act(async () => generation.props.onGenerateMonochrome());
    expect(quoteOpen).toHaveBeenCalledWith({ pageId: 'page', pageNumber: 1, renderStyle: 'monochrome' });
    expect(action).not.toHaveBeenCalled();
  });
});

describe('割当人物の1件選択編集', () => {
  it('人物選択だけではdirtyにせず全人物の未保存値を保持する', async () => {
    const { AssignmentEditor } = await import('@/screens/PagesScreen');
    const { panelAssignmentDefaults } = await import('@/constants/options');
    const onChange = vi.fn();
    const initial = ['a', 'b'].map(entity_id => ({ ...panelAssignmentDefaults, entity_id, facing_direction: '' as const }));
    function Harness(): React.JSX.Element {
      const [assignments, setAssignments] = React.useState(initial);
      return <AssignmentEditor assignments={assignments} entities={[{ id:'a', name:'A' }, { id:'b', name:'B' }] as never} language="ja" onChange={(next) => { onChange(next); setAssignments(next); }} />;
    }
    await act(async () => { root = create(<Harness />); });
    const select = async (id:string):Promise<void> => { await act(async () => root!.root.findByProps({testID:`assignment-select-${id}`}).props.onPress()); };
    const effect = ():ReactTestRenderer['root'] => root!.root.findAllByType('field').find(node => node.props.maxLength === 200)!;
    expect(root!.root.findAllByType('EntityStatePicker')).toHaveLength(1);
    await select('b'); expect(onChange).not.toHaveBeenCalled();
    await act(async () => effect().props.onChangeText('B unsaved'));
    await select('a'); await act(async () => effect().props.onChangeText('A unsaved'));
    await select('b'); expect(effect().props.value).toBe('B unsaved');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.lastCall?.[0].map((row:{effect_note:string})=>row.effect_note)).toEqual(['A unsaved','B unsaved']);
  });
  it('read-onlyでも全人物を選択して閲覧でき入力はdisabledのまま', async () => {
    const { AssignmentEditor } = await import('@/screens/PagesScreen');
    const { panelAssignmentDefaults } = await import('@/constants/options'); const onChange = vi.fn();
    await act(async () => { root = create(<AssignmentEditor assignments={['a','b'].map(entity_id => ({...panelAssignmentDefaults,entity_id,facing_direction:''}))} entities={[{id:'a',name:'A'},{id:'b',name:'B'}] as never} language="en" disabled onChange={onChange} />); });
    await act(async () => root!.root.findByProps({testID:'assignment-select-b'}).props.onPress());
    expect(root!.root.findByType('EntityStatePicker').props.entityId).toBe('b');
    expect(root!.root.findByType('EntityStatePicker').props.disabled).toBe(true);
    expect(root!.root.findAllByType('field').every(node=>node.props.editable===false)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});


describe('画面外話者のPages配線',()=>{
  async function setup(speaker:string):Promise<void>{
    const {panelAssignmentDefaults}=await import('@/constants/options');
    queryData.entities.pages=[{entities:[{id:'visible',work_id:'work',name:'Visible'},{id:'off-panel',work_id:'work',name:'Off panel'},{id:'foreign',work_id:'other-work',name:'Foreign'}] as EntityRecord[]}];
    panels[0].entities=[{...panelAssignmentDefaults,entity_id:'visible'}];
    panels[0].dialogue=[{entity_id:speaker,text:'同じworkの画面外からの声',type:'speech',position:'right'}];
    moreEntities=true;
    await act(async()=>{root=create(<PagesScreen/>);});
    await act(async()=>root!.root.findByType('PanelOrderList').props.onSelect('panel'));
  }
  function dialogueProps():React.ComponentProps<typeof PanelDialogueEditor>{
    const fragment=root!.root.findByType('PanelEditorSections').props.sections.dialogue;
    return (React.Children.toArray(fragment.props.children).find(node=>React.isValidElement(node)&&node.type===PanelDialogueEditor) as React.ReactElement<React.ComponentProps<typeof PanelDialogueEditor>>).props;
  }
  it('同workの画面外話者を許可しforeign候補を除外してassignmentは増やさない',async()=>{
    await setup('off-panel'); const props=dialogueProps();
    expect(props.entities.map(entity=>entity.id)).toEqual(['visible','off-panel']);
    expect(props.visibleEntityIds).toEqual(['visible']);
    expect(root!.root.findByProps({testID:'panel-save'}).props.disabled).toBe(false);
    expect(root!.root.findByType('PanelEditorSections').props.sections.characters.props.assignments.map((row:{entity_id:string})=>row.entity_id)).toEqual(['visible']);
    expect(action).not.toHaveBeenCalled();expect(props.hasMoreEntities).toBe(true);
    await act(async()=>props.onLoadMoreEntities?.());expect(fetchEntities).toHaveBeenCalledOnce();
  });
  it('未読込・未知や他workの保存済み話者を他人へ置換せず保存を止める',async()=>{
    await setup('unknown');
    expect(dialogueProps().dialogues[0].entity_id).toBe('unknown');
    expect(root!.root.findByProps({testID:'panel-save'}).props.disabled).toBe(true);
    await act(async()=>dialogueProps().onChange([{entity_id:'foreign',text:'retained',type:'thought',position:'right'}]));
    expect(dialogueProps().dialogues[0].entity_id).toBe('foreign');
    expect(root!.root.findByProps({testID:'panel-save'}).props.disabled).toBe(true);
    expect(root!.root.findByType('PanelEditorSections').props.sections.characters.props.assignments).toHaveLength(1);
  });
});
