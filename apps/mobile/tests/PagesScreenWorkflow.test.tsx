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
let screenSelection = { organizationId: null as string | null, workId: 'work', chapterId: 'chapter', episodeId: 'episode', pageId: 'page' as string | null, entityId: null as string | null };
let workspaceSelection = { selectedWorkId: 'work', selectedEpisodeId: 'episode' };
let activeDesignJobId: string | null = null;
let skeletonCapability: { preserve_generated_images: boolean } | undefined;
let currentSessionKey = 'user';
const { action, dirtyRegistration, quoteOpen, fetchEntities, openUrl, confirmAction, generatePageSkeleton, autofillStory, replaceFrames, updateSelection, invalidateQueries } = vi.hoisted(() => ({ action: vi.fn(), dirtyRegistration: vi.fn(), quoteOpen: vi.fn(), fetchEntities: vi.fn(), openUrl: vi.fn().mockResolvedValue(undefined), confirmAction: vi.fn(), generatePageSkeleton: vi.fn(), autofillStory: vi.fn(), replaceFrames: vi.fn(), updateSelection: vi.fn(), invalidateQueries: vi.fn().mockResolvedValue(undefined) }));
const api = { updatePage: action, updatePanel: action, generatePage: action, generatePageSkeleton, autofillEpisodePagesFromStory: autofillStory, replaceFrames };
let root: ReactTestRenderer | undefined;
vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: action }), useIsFocused: () => true }));
vi.mock('react-native', () => ({ Keyboard: { dismiss: vi.fn() }, Linking: { openURL: openUrl }, Modal: 'modal', Pressable: 'button', ScrollView: 'scroll', Text: 'text', View: 'view', StyleSheet: { create: <T,>(styles: T): T => styles } }));
vi.mock('expo-image', () => ({ Image: { prefetch: vi.fn().mockResolvedValue(true) } }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries, setQueryData: vi.fn() }),
  useInfiniteQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === 'pages' ? queryData.pages : queryData.entities, isSuccess: true, isFetching: false, hasNextPage: queryKey[0] === 'pages' ? false : moreEntities, isFetchingNextPage: false, fetchNextPage: fetchEntities, error: null }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === 'panels' ? queryData.panels : queryKey[0] === 'frames' ? queryData.frames : queryKey[0] === 'scenes' ? queryData.scenes : queryKey[0] === 'page-generation-readiness' ? queryData.readiness : queryKey[0] === 'page-layout-templates' ? queryData.templates : queryKey[0] === 'page-skeleton-capabilities' ? skeletonCapability : undefined, isSuccess: true, isFetching: false, isLoading: false, error: null, refetch: vi.fn() }),
  useMutation: (options: { mutationFn: (...args: unknown[]) => Promise<unknown>; onSuccess?: (value: unknown, variables?: unknown) => Promise<void>; onError?: (error: unknown, variables?: unknown) => void | Promise<void> }) => {
    const [error, setError] = React.useState<unknown>(null);
    const run = async (...args: unknown[]): Promise<unknown> => {
      try { const value = await options.mutationFn(...args); await options.onSuccess?.(value, args[0]); setError(null); return value; }
      catch (cause) { await options.onError?.(cause, args[0]); setError(cause); throw cause; }
    };
    return { mutate: (...args: unknown[]) => { void run(...args).catch(() => undefined); }, mutateAsync: run, isPending: false, error, reset: () => setError(null) };
  }
}));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api, hasCapability: () => true, language: 'ja', logout: action, selection: screenSelection, session: { capabilities: { generation_quotes: true } }, sessionKey: currentSessionKey, tokens: null, trackJob: action, updateSelection }) }));
vi.mock('@/state/dirtyState', () => ({ useDirtyEditorRegistration: dirtyRegistration, useDirtyState: () => ({ resolveDirtyEditors: vi.fn().mockResolvedValue(true), hasDirtyEditors: false }) }));
vi.mock('@/state/mangaWorkflow', () => ({ useMangaWorkflow: () => ({ activeStep: 'pages' }) }));
vi.mock('@/hooks/usePageGenerationQuote', () => ({ usePageGenerationQuote: () => ({ state: { phase: 'closed', visible: false, target: null, quote: null }, controller: { open: quoteOpen, close: vi.fn(), accept: vi.fn(), reconcile: vi.fn(), canAccept: () => false } }) }));
vi.mock('@/hooks/usePageCompletion', () => ({ usePageCompletion: () => ({ result: null, visible: false, complete: vi.fn(), open: vi.fn(), close: vi.fn() }) }));
vi.mock('@/lib/confirmationPresentation', () => ({ useConfirmationPresentation: () => false }));
vi.mock('@/hooks/useActiveResourceJobId', () => ({ useActiveResourceJobId: () => activeDesignJobId }));
vi.mock('@/hooks/usePanelInsertion', () => ({ usePanelInsertion: () => ({ blocker: null, operationActive: false, notice: null, insertAfter: vi.fn(), reload: vi.fn() }) }));
vi.mock('@/hooks/useResetOnScopeChange', () => ({ useResetOnScopeChange: vi.fn() }));
vi.mock('@/constants/mobileFeatureVisibility', () => ({ pageLayoutEditingUiEnabled: true }));
vi.mock('@/lib/confirm', () => ({ confirmAction, confirmDestructiveAction: confirmAction }));
vi.mock('@/lib/confirmStoryStateAutofill', () => ({
  confirmStoryStateAutofill: (input: { onConfirm: (options: undefined) => void }) => confirmAction({ onConfirm: () => input.onConfirm(undefined) })
}));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/config', () => ({ config: { apiBaseUrl: 'https://example.test', webEditorUrl: 'https://d2dw83tkmziksr.cloudfront.net/', episodeExportEnabled: false } }));
vi.mock('@/lib/download', () => ({ appendOrganizationQuery: vi.fn(), downloadAuthenticatedFile: action }));
vi.mock('@/components/WorkspaceContextPicker', () => ({ useWorkspaceContextSelection: () => workspaceSelection }));
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
vi.mock('@/components/StoryGenerationControls', () => ({ StoryGenerationControls: (props: Record<string, unknown>) => React.createElement('StoryGenerationControls', props) }));
vi.mock('@/components/WorkspaceHierarchyNavigator', () => ({ WorkspaceHierarchyNavigator: (props: Record<string, unknown>) => React.createElement('WorkspaceHierarchyNavigator', props) }));

beforeEach(() => {
  action.mockReset(); dirtyRegistration.mockReset(); quoteOpen.mockReset(); confirmAction.mockReset(); generatePageSkeleton.mockReset(); autofillStory.mockReset(); replaceFrames.mockReset(); updateSelection.mockReset(); invalidateQueries.mockReset();
  screenSelection = { organizationId: null, workId: 'work', chapterId: 'chapter', episodeId: 'episode', pageId: 'page', entityId: null };
  workspaceSelection = { selectedWorkId: 'work', selectedEpisodeId: 'episode' };
  activeDesignJobId = null;
  currentSessionKey = 'user';
  updateSelection.mockImplementation(async (next: { pageId?: string | null }) => {
    screenSelection = { ...screenSelection, ...next };
    return true;
  });
  openUrl.mockResolvedValue(undefined); generatePageSkeleton.mockResolvedValue({ job_id: 'skeleton-job', queued: true, story_plan_applied: false }); autofillStory.mockResolvedValue({ job_id: 'autofill-job', queued: true }); replaceFrames.mockResolvedValue({ frames });
  invalidateQueries.mockResolvedValue(undefined);
  moreEntities=false; page.layout_config={}; queryData.pages={pages:[{pages:[page]}],pageParams:[null]}; queryData.panels={panels}; queryData.frames={frames}; queryData.entities.pages=[{entities:[]}]; panels[0].entities=[]; panels[0].dialogue=[];
  skeletonCapability = { preserve_generated_images: true };
});
afterEach(async () => { await act(async () => root?.unmount()); });
describe('実際のPagesScreenの工程構成', () => {
  it('ページ未選択で開くと最初のページとコマを編集対象にする', async () => {
    screenSelection = { ...screenSelection, pageId: null };
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    expect(updateSelection).toHaveBeenCalledWith({ pageId: 'page' });
  });

  it('復元済みの有効なページでは最小保存順のコマを初回だけ選ぶ', async () => {
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    expect(root!.root.findByType('PanelOrderList').props.selectedPanelId).toBe('panel');
    expect(updateSelection).not.toHaveBeenCalled();
  });

  it('ページ選択の永続化待ち後もキャッシュ済みの先頭コマを消さない', async () => {
    let resolveSelection: ((changed: boolean) => void) | undefined;
    updateSelection.mockImplementation(() => new Promise<boolean>((resolve) => { resolveSelection = resolve; }));
    screenSelection = { ...screenSelection, pageId: null };
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    screenSelection = { ...screenSelection, pageId: 'page' };
    await act(async () => { root!.update(<PagesScreen />); await Promise.resolve(); });
    expect(root!.root.findByType('PanelOrderList').props.selectedPanelId).toBe('panel');

    await act(async () => { resolveSelection?.(true); await Promise.resolve(); });
    expect(root!.root.findByType('PanelOrderList').props.selectedPanelId).toBe('panel');
  });

  it('明示選択済みのページは再取得時に最初のページへ戻さない', async () => {
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    expect(updateSelection).not.toHaveBeenCalled();
  });

  it('復元したserver自動入力完了後も先頭ページとコマを選び直す', async () => {
    activeDesignJobId = 'server-autofill-job';
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    const job = root!.root.findAllByType('JobStatusCard').find((node) => node.props.jobId === 'server-autofill-job');
    expect(job).toBeDefined();
    await act(async () => { await job!.props.onCompleted(); });
    expect(updateSelection).toHaveBeenCalledWith({ pageId: null }, { skipDirtyCheck: true });

    await act(async () => { root!.update(<PagesScreen />); await Promise.resolve(); });
    expect(updateSelection).toHaveBeenCalledWith({ pageId: 'page' });
    await act(async () => { root!.update(<PagesScreen />); await Promise.resolve(); });
    expect(root!.root.findByType('PanelOrderList').props.selectedPanelId).toBe('panel');
  });

  it('完了処理の待機中に話を切り替えた場合は新しい選択を消さない', async () => {
    activeDesignJobId = 'server-autofill-job';
    const releaseInvalidations: (() => void)[] = [];
    invalidateQueries.mockImplementation(() => new Promise<void>((resolve) => { releaseInvalidations.push(resolve); }));
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    const job = root!.root.findAllByType('JobStatusCard').find((node) => node.props.jobId === 'server-autofill-job');
    const completion = job!.props.onCompleted();
    workspaceSelection = { selectedWorkId: 'other-work', selectedEpisodeId: 'other-episode' };
    screenSelection = { ...screenSelection, workId: 'other-work', episodeId: 'other-episode', pageId: 'page' };
    await act(async () => { root!.update(<PagesScreen />); await Promise.resolve(); });
    await act(async () => { releaseInvalidations.forEach((release) => release()); await completion; });
    expect(updateSelection).not.toHaveBeenCalledWith({ pageId: null }, { skipDirtyCheck: true });
  });

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
  it('工程を連続表示して入力を保持し現在設定previewを表示しない', async () => {
    await act(async () => { root = create(<PagesScreen />); });
    const style = (): ReactTestRenderer['root'] => root!.root.findAllByType('field').find((node) => node.props.label === '参考にしたい作品・画風')!;
    await act(async () => style().props.onChangeText('保持する入力'));
    expect(style().props.value).toBe('保持する入力');
    expect(action).not.toHaveBeenCalled(); expect(quoteOpen).not.toHaveBeenCalled();
    expect(root!.root.findAllByProps({ testID: 'page-settings-preview' })).toHaveLength(0);
    expect(root!.root.findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('page-step-'))).toHaveLength(0);
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
  it('上部CTAを一本化しpage number選択とcolor/monochrome入口を維持する', async () => {
    await act(async () => { root = create(<PagesScreen />); });
    expect(root!.root.findAllByType('button').filter((node) => node.props.testID === 'page-story-autofill-primary')).toHaveLength(1);
    expect(root!.root.findAllByType('StoryGenerationControls')).toHaveLength(0);
    const picker = root!.root.findAllByType('picker').find((node) => node.props.items?.some((item: { id: string }) => item.id === 'page'));
    expect(picker?.props.labelForItem(page)).toBe('1ページ');
    const generation = root!.root.findByProps({ testID: 'page-monochrome-generation-action' });
    await act(async () => generation.props.onPress());
    expect(quoteOpen).toHaveBeenCalledWith({ pageId: 'page', pageNumber: 1, renderStyle: 'monochrome' });
    expect(action).not.toHaveBeenCalled();
  });

  it('ページが無い場合は確認後にskeleton完了を待って同じ話へautofillを一度だけqueueする', async () => {
    queryData.pages = { pages: [{ pages: [] }], pageParams: [null] };
    queryData.panels = { panels: [] };
    queryData.frames = { frames: [] };
    await act(async () => { root = create(<PagesScreen />); });
    await act(async () => {
      root!.root.findAllByType('button').find((node) => node.props.testID === 'page-story-autofill-primary')!.props.onPress();
      await Promise.resolve();
    });
    expect(confirmAction).toHaveBeenCalledOnce();
    const confirm = confirmAction.mock.lastCall?.[0] as { onConfirm: () => void };
    expect(typeof confirm.onConfirm).toBe('function');
    await act(async () => { confirm.onConfirm(); await Promise.resolve(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(generatePageSkeleton).toHaveBeenCalledOnce();
    expect(autofillStory).not.toHaveBeenCalled();
    const job = root!.root.findAllByType('JobStatusCard').find((node) => node.props.jobId === 'skeleton-job');
    await act(async () => { await job?.props.onCompleted(); });
    expect(autofillStory).toHaveBeenCalledTimes(1);
    expect(autofillStory).toHaveBeenCalledWith('episode', 'ja', null, undefined);
  });

  it('既存ページでも確認後に骨格を再生成してから同じ話へautofillを一度だけqueueする', async () => {
    await act(async () => { root = create(<PagesScreen />); });
    await act(async () => {
      root!.root.findAllByType('button').find((node) => node.props.testID === 'page-story-autofill-primary')!.props.onPress();
      await Promise.resolve();
    });
    const confirm = confirmAction.mock.lastCall?.[0] as { onConfirm: () => void };
    await act(async () => { confirm.onConfirm(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(generatePageSkeleton).toHaveBeenCalledOnce();
    expect(generatePageSkeleton).toHaveBeenCalledWith('episode', {
      apply_story_plan: false,
      language: 'ja',
      overwrite_existing: true,
      preserve_generated_images: true
    }, null);
    expect(autofillStory).not.toHaveBeenCalled();
    const job = root!.root.findAllByType('JobStatusCard').find((node) => node.props.jobId === 'skeleton-job');
    await act(async () => { await job?.props.onCompleted(); });
    expect(autofillStory).toHaveBeenCalledExactlyOnceWith('episode', 'ja', null, undefined);
  });

  it('自動入力後の枠再取得は未保存編集と誤認せず次の自動入力前に再保存しない', async () => {
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    queryData.frames = {
      frames: [{ ...frames[0]!, id: 'server-refreshed-frame', reading_order: 2 }],
    };

    await act(async () => {
      root!.update(<PagesScreen />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(dirtyRegistration.mock.lastCall?.[0]).toMatchObject({ dirty: false });

    await act(async () => {
      root!.root.findAllByType('button').find((node) => node.props.testID === 'page-story-autofill-primary')!.props.onPress();
      await Promise.resolve();
    });
    const confirm = confirmAction.mock.lastCall?.[0] as { onConfirm: () => void };
    await act(async () => { confirm.onConfirm(); await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(replaceFrames).not.toHaveBeenCalled();
    expect(generatePageSkeleton).toHaveBeenCalledOnce();
  });

  it('枠編集を一度保存してskeleton完了後にautofillを受付し枠を再保存しない', async () => {
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    const readingOrder = root!.root.findAllByType('field').find((node) => node.props.label === '読み順')!;
    await act(async () => { readingOrder.props.onChangeText('2'); });

    await act(async () => {
      root!.root.findByProps({ testID: 'page-story-autofill-primary' }).props.onPress();
      await Promise.resolve();
    });
    const confirm = confirmAction.mock.lastCall?.[0] as { onConfirm: () => void };
    await act(async () => { confirm.onConfirm(); await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(replaceFrames).toHaveBeenCalledOnce();
    expect(generatePageSkeleton).toHaveBeenCalledOnce();
    const job = root!.root.findAllByType('JobStatusCard').find((node) => node.props.jobId === 'skeleton-job');
    await act(async () => { await job?.props.onCompleted(); });
    expect(autofillStory).toHaveBeenCalledOnce();
    expect(replaceFrames).toHaveBeenCalledOnce();
  });

  it('枠保存が失敗した自動入力は送信せず入力を保持し同じ操作の再試行成功後に受付する', async () => {
    replaceFrames.mockRejectedValueOnce(new Error('frame validation rejected'));
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    const readingOrder = (): ReactTestRenderer['root'] =>
      root!.root.findAllByType('field').find((node) => node.props.label === '読み順')!;
    await act(async () => { readingOrder().props.onChangeText('2'); });
    const pressPrimary = async (): Promise<void> => {
      await act(async () => {
        root!.root.findByProps({ testID: 'page-story-autofill-primary' }).props.onPress();
        await Promise.resolve();
      });
      const confirm = confirmAction.mock.lastCall?.[0] as { onConfirm: () => void };
      await act(async () => { confirm.onConfirm(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    };

    await pressPrimary();
    expect(replaceFrames).toHaveBeenCalledOnce();
    expect(generatePageSkeleton).not.toHaveBeenCalled();
    expect(autofillStory).not.toHaveBeenCalled();
    expect(readingOrder().props.value).toBe('2');
    expect(root!.root.findAllByType('PageErrorRecoveryNotice')).toHaveLength(1);

    await pressPrimary();
    expect(replaceFrames).toHaveBeenCalledTimes(2);
    expect(generatePageSkeleton).toHaveBeenCalledOnce();
    expect(root!.root.findAllByType('PageErrorRecoveryNotice')).toHaveLength(0);
    const job = root!.root.findAllByType('JobStatusCard').find((node) => node.props.jobId === 'skeleton-job');
    await act(async () => { await job?.props.onCompleted(); });
    expect(autofillStory).toHaveBeenCalledOnce();
  });

  it('自動入力前のdraft保存中にscopeが変わった場合は旧scopeへ枠を送らない', async () => {
    let releasePageSave: ((value: PageRecord) => void) | undefined;
    action.mockImplementation(() => new Promise<PageRecord>((resolve) => { releasePageSave = resolve; }));
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    const style = root!.root.findAllByType('field').find((node) => node.props.label === '参考にしたい作品・画風')!;
    const readingOrder = root!.root.findAllByType('field').find((node) => node.props.label === '読み順')!;
    await act(async () => {
      style.props.onChangeText('保存待機中の入力');
      readingOrder.props.onChangeText('2');
    });

    await act(async () => {
      root!.root.findAllByType('button').find((node) => node.props.testID === 'page-story-autofill-primary')!.props.onPress();
      await Promise.resolve();
    });
    const confirm = confirmAction.mock.lastCall?.[0] as { onConfirm: () => void };
    await act(async () => { confirm.onConfirm(); await Promise.resolve(); });
    expect(action).toHaveBeenCalled();

    currentSessionKey = 'other-user';
    await act(async () => { root!.update(<PagesScreen />); await Promise.resolve(); });
    await act(async () => {
      releasePageSave?.(page);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(replaceFrames).not.toHaveBeenCalled();
    expect(generatePageSkeleton).not.toHaveBeenCalled();
  });

  it('ページ切替後に新ページの枠がhydrateされる前は旧ページの枠を保存しない', async () => {
    const nextPage: PageRecord = { ...page, id: 'next-page', page_number: 2 };
    queryData.pages = { pages: [{ pages: [page, nextPage] }], pageParams: [null] };
    screenSelection = { ...screenSelection, pageId: nextPage.id };
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });

    const frameSave = root!.root.findByProps({ testID: 'frame-save' });
    expect(frameSave.props.disabled).toBe(true);
    expect(() => frameSave.props.onPress()).toThrow();

    expect(replaceFrames).not.toHaveBeenCalled();
  });

  it('枠保存の応答待ちに追加編集した場合は新しい入力を保持してdirtyを解消しない', async () => {
    let releaseFrameSave: ((value: { frames: PanelFrameRecord[] }) => void) | undefined;
    replaceFrames.mockImplementationOnce(() =>
      new Promise<{ frames: PanelFrameRecord[] }>((resolve) => { releaseFrameSave = resolve; })
    );
    await act(async () => { root = create(<PagesScreen />); await Promise.resolve(); });
    const readingOrder = (): ReactTestRenderer['root'] =>
      root!.root.findAllByType('field').find((node) => node.props.label === '読み順')!;
    await act(async () => { readingOrder().props.onChangeText('2'); });

    await act(async () => {
      root!.root.findByProps({ testID: 'frame-save' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => { readingOrder().props.onChangeText('3'); });
    await act(async () => {
      releaseFrameSave?.({ frames: [{ ...frames[0]!, reading_order: 2 }] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(replaceFrames).toHaveBeenCalledOnce();
    expect(replaceFrames.mock.calls[0]?.[1]).toEqual({
      frames: [expect.objectContaining({ id: 'frame', reading_order: 2 })],
    });
    expect(readingOrder().props.value).toBe('3');
    expect(dirtyRegistration.mock.lastCall?.[0]).toMatchObject({ dirty: true });
  });

  it('画像保持capabilityを確認できない旧serverでは既存ページを上書きしない', async () => {
    skeletonCapability = undefined;
    await act(async () => { root = create(<PagesScreen />); });
    const actionButton = root!.root.findAllByType('button').find((node) => node.props.testID === 'page-story-autofill-primary')!;
    expect(actionButton.props.disabled).toBe(true);
    await act(async () => { actionButton.props.onPress(); await Promise.resolve(); });
    expect(confirmAction).not.toHaveBeenCalled();
    expect(generatePageSkeleton).not.toHaveBeenCalled();
    expect(autofillStory).not.toHaveBeenCalled();
  });

  it('skeleton失敗時はautofillせず同じボタンから安全に再試行できる', async () => {
    queryData.pages = { pages: [{ pages: [] }], pageParams: [null] };
    queryData.panels = { panels: [] };
    queryData.frames = { frames: [] };
    await act(async () => { root = create(<PagesScreen />); });
    const pressPrimary = async (): Promise<void> => {
      await act(async () => {
        root!.root.findAllByType('button').find((node) => node.props.testID === 'page-story-autofill-primary')!.props.onPress();
        await Promise.resolve();
      });
      const confirm = confirmAction.mock.lastCall?.[0] as { onConfirm: () => void };
      await act(async () => { confirm.onConfirm(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    };
    await pressPrimary();
    expect(generatePageSkeleton).toHaveBeenCalledOnce();
    const job = root!.root.findAllByType('JobStatusCard').find((node) => node.props.jobId === 'skeleton-job');
    await act(async () => { await job?.props.onFailed(); });
    expect(autofillStory).not.toHaveBeenCalled();
    await pressPrimary();
    expect(generatePageSkeleton).toHaveBeenCalledTimes(2);
    expect(autofillStory).not.toHaveBeenCalled();
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
