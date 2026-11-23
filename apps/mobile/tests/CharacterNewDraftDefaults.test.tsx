import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharactersScreen } from '@/screens/CharactersScreen';
import type { EntityRecord } from '@/domain/types';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReactTestRenderer | undefined;
let entity: EntityRecord;
let selection: { workId: string; entityId: string | null; organizationId: string | null };
let sessionKey: string;
let entityDetail: EntityRecord | undefined;
let entityDetailError: Error | null;
let entitiesError: Error | null;
let language: 'ja' | 'en';
let characterAutofillEnabled = false;
const refetchEntity = vi.fn();
let pages: { entities: EntityRecord[] }[];
let registration: {dirty:boolean;save:()=>Promise<void>;discard:()=>void};
const updateEntity=vi.fn(); const createEntity=vi.fn(); const getEntity=vi.fn(); const getEpisodes=vi.fn(); const suggestEpisodeCharacters=vi.fn(); const getCharacterSuggestionCapabilities=vi.fn(); const getCharacterAutofillCapabilities=vi.fn(); const autofillEpisodeCharacters=vi.fn(); const approveCharacterAppearance=vi.fn(); const navigate=vi.fn(); const trackJob=vi.fn();
const resolveDirtyEditors = vi.fn();
const saveDirtyEditors = vi.fn();
const assetQuoteCapture = vi.hoisted(() => ({ options: null as Record<string, unknown> | null }));
const updateSelection = vi.fn(async (next: Partial<typeof selection>) => { selection = { ...selection, ...next }; return true; });
const queryClient={invalidateQueries:vi.fn(),fetchQuery:vi.fn()};
const query=(data:unknown):Record<string,unknown>=>({data,error:null,isFetching:false,refetch:vi.fn()});
vi.mock('react-native',()=>({Pressable:'button',ScrollView:'scroll',View:'view',Text:'text',StyleSheet:{create:<T,>(styles:T):T=>styles}}));
vi.mock('@react-navigation/native',()=>({useNavigation:()=>({navigate})}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>queryClient,
 useInfiniteQuery:()=>({...query({pages}),error:entitiesError,hasNextPage:false,isFetchingNextPage:false,fetchNextPage:vi.fn()}),
 useQuery:(options:{queryKey:readonly unknown[]})=>options.queryKey[0] === 'entity-detail'
   ? {...query(entityDetail),error:entityDetailError,refetch:refetchEntity}
   : options.queryKey[0] === 'character-autofill-capabilities'
     ? query({enabled:characterAutofillEnabled})
   : options.queryKey[0] === 'character-suggestion-capabilities'
     ? query({enabled:true})
     : query(undefined),
 useMutation:(options:{mutationFn:(variables?:unknown)=>Promise<unknown>;onSuccess?:(value:unknown,variables?:unknown)=>Promise<void>;onError?:(error:unknown)=>void})=>{
 const run=async(variables?:unknown):Promise<unknown>=>{try{const value=await options.mutationFn(variables);await options.onSuccess?.(value,variables);return value;}catch(error){options.onError?.(error);throw error;}};
 return {mutateAsync:run,mutate:(variables?:unknown)=>{void run(variables);},isPending:false,error:null,reset:vi.fn()};}
}));
vi.mock('@/state/appState',()=>({useAppState:()=>({api:{updateEntity,createEntity,getEntity,getEpisodes,suggestEpisodeCharacters,getCharacterSuggestionCapabilities,getCharacterAutofillCapabilities,autofillEpisodeCharacters,approveCharacterAppearance},hasCapability:()=>true,language,logout:vi.fn(),selection,session:{organizations:[],capabilities:{}},sessionKey,tokens:null,trackJob,updateSelection})}));
vi.mock('@/state/dirtyState',()=>({useDirtyState:()=>({resolveDirtyEditors, saveDirtyEditors}),useDirtyEditorRegistration:(input:typeof registration)=>{registration=input;}}));
vi.mock('@/hooks/useActiveResourceJobId',()=>({useActiveResourceJobId:()=>null}));
vi.mock('@/hooks/useAssetGenerationQuote',()=>({useAssetGenerationQuote:(options: Record<string, unknown>)=>{assetQuoteCapture.options=options;return {state:{phase:'closed',visible:false},controller:{open:vi.fn(),close:vi.fn(),accept:vi.fn(),reconcile:vi.fn(),canAccept:()=>false}};}}));
vi.mock('@/components/WorkspaceContextPicker',()=>({useWorkspaceContextSelection:()=>({selectedWorkId:selection.workId,selectedChapterId:'chapter',selectedEpisodeId:'episode'})}));
vi.mock('@/lib/config',()=>({config:{apiBaseUrl:'https://example.test'}}));
vi.mock('@/lib/api',()=>({ApiError:class ApiError extends Error{}}));
vi.mock('@/lib/download',()=>({appendOrganizationQuery:vi.fn(),downloadAuthenticatedFile:vi.fn()}));
vi.mock('@/lib/confirm',()=>({confirmAction:vi.fn(),confirmDestructiveAction:vi.fn()}));
vi.mock('@/lib/confirmStaleDraftReload',()=>({confirmStaleDraftReload:vi.fn()}));
vi.mock('@/components/Screen',()=>({Screen:({children}:{children:React.ReactNode})=>children}));
vi.mock('@/components/Section',()=>({Section:({children,collapsible=false,defaultCollapsed=false,...props}:{children:React.ReactNode;collapsible?:boolean;defaultCollapsed?:boolean;title:string})=>{
  const [collapsed,setCollapsed]=React.useState(defaultCollapsed);
  return React.createElement('Section',props,
    collapsible ? React.createElement('button',{accessibilityLabel:props.title,onClick:()=>setCollapsed((current)=>!current)},props.title) : null,
    collapsed ? null : children,
  );
}}));
vi.mock('@/components/ActionableErrorNotice',()=>({ActionableErrorNotice:(props:Record<string,unknown>)=>React.createElement('ActionableErrorNotice',props)}));
vi.mock('@/components/CharacterChoiceField',()=>({CharacterChoiceField:(props:Record<string,unknown>)=>React.createElement('CharacterChoiceField',props)}));
vi.mock('@/components/CharacterThumbnailPicker',()=>({CharacterThumbnailPicker:(props:Record<string,unknown>)=>React.createElement('CharacterThumbnailPicker',props)}));
vi.mock('@/components/CharacterOutfitField',()=>({CharacterOutfitField:(props:Record<string,unknown>)=>React.createElement('CharacterOutfitField',props)}));
vi.mock('@/components/EntityGenerationBlockers',()=>({EntityGenerationBlockers:(props:Record<string,unknown>)=>React.createElement('EntityGenerationBlockers',props)}));
vi.mock('@/components/AssetGenerationQuoteDialog',()=>({AssetGenerationQuoteDialog:(props:Record<string,unknown>)=>React.createElement('AssetGenerationQuoteDialog',props)}));
vi.mock('@/components/QuotedEntityImport',()=>({QuotedEntityImport:(props:Record<string,unknown>)=>React.createElement('QuotedEntityImport',props)}));
vi.mock('@/components/FormField',()=>({FormField:(props:Record<string,unknown>)=>React.createElement('FormField',props)}));
vi.mock('@/components/ImagePreviewModal',()=>({ImagePreviewModal:(props:Record<string,unknown>)=>React.createElement('ImagePreviewModal',props)}));
vi.mock('@/components/JobStatusCard',()=>({JobStatusCard:(props:Record<string,unknown>)=>React.createElement('JobStatusCard',props)}));
vi.mock('@/components/Notice',()=>({Notice:(props:Record<string,unknown>)=>React.createElement('Notice',props)}));
vi.mock('@/components/PrimaryButton',()=>({PrimaryButton:(props:Record<string,unknown>)=>React.createElement('PrimaryButton',props)}));
vi.mock('@/components/RecordPicker',()=>({RecordPicker:(props:Record<string,unknown>)=>React.createElement('RecordPicker',props)}));
vi.mock('@/components/ResilientImage',()=>({ResilientImage:(props:Record<string,unknown>)=>React.createElement('ResilientImage',props)}));
vi.mock('@/components/SegmentedControl',()=>({SegmentedControl:(props:Record<string,unknown>)=>React.createElement('SegmentedControl',props)}));
vi.mock('@/components/WorkspaceHierarchyNavigator',()=>({WorkspaceHierarchyNavigator:(props:Record<string,unknown>)=>React.createElement('WorkspaceHierarchyNavigator',props)}));
vi.mock('@/components/EntityStateEditor',()=>({EntityStateEditor:(props:Record<string,unknown>)=>React.createElement('EntityStateEditor',props)}));


const expectedDefaults = {
  gender_expression: 'male',
  age_range: 'twenties',
  skin_tone: 'fair',
  first_impression: 'bright_friendly',
  standing_style: 'upright_neat',
  default_expression: 'soft_smile',
};
const defaultLabels = ['性別表現', '年齢帯', '肌の色', '第一印象', '立ち姿', '標準表情'];

beforeEach(() => {
  selection = { workId: 'work', entityId: null, organizationId: null };
  sessionKey = 'user';
  language = 'ja';
  characterAutofillEnabled = false;
  entityDetail = undefined;
  entityDetailError = null;
  entitiesError = null;
  refetchEntity.mockReset();
  entity = { id: 'entity', work_id: 'work', name: 'Saved hero', entity_type: 'character',
    free_description: null, prompt_supplement: null, speech_profile: {},
    structured_fields: { gender_expression: '', age_range: null, skin_tone: '',
      character_identity: { aliases: ['Ace, Jr.'] } }, updated_at: 'revision' } as unknown as EntityRecord;
  pages = [{ entities: [entity] }];
  updateEntity.mockReset().mockResolvedValue(entity);
  createEntity.mockReset().mockResolvedValue({ ...entity, id: 'created' });
  getEpisodes.mockReset().mockResolvedValue({ episodes: [{ id: 'episode', version: 3 }] });
  suggestEpisodeCharacters.mockReset().mockResolvedValue({ version: 3, characters: [] });
  getCharacterSuggestionCapabilities.mockReset().mockResolvedValue({ enabled: true });
  getCharacterAutofillCapabilities.mockReset().mockResolvedValue({ enabled: false });
  autofillEpisodeCharacters.mockReset().mockResolvedValue({ version: 3, characters: [], skipped_names: [] });
  approveCharacterAppearance.mockReset();
  getEntity.mockReset().mockResolvedValue(entity);
  updateSelection.mockClear();
  resolveDirtyEditors.mockReset().mockResolvedValue(true);
  saveDirtyEditors.mockReset().mockResolvedValue(true);
  trackJob.mockReset().mockResolvedValue(undefined);
  assetQuoteCapture.options = null;
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });
const render = async (): Promise<void> => { await act(async () => { root = create(<CharactersScreen />); }); };
const rerender = async (): Promise<void> => { await act(async () => root!.update(<CharactersScreen />)); };
const choice = (label: string) => root!.root.findAllByType('CharacterChoiceField').find(node => node.props.label === label)!;
const field = (label: string) => root!.root.findAllByType('FormField').find(node => node.props.label === label)!;
const changeType = async (value: string): Promise<void> => {
  await act(async () => root!.root.findByType('SegmentedControl').props.onChange(value));
};
const openNew = async (): Promise<void> => {
  await act(async () => root!.root.findByType('RecordPicker').props.onSelect('new-entity'));
  await rerender();
};
const openAutofillReview = async (): Promise<void> => {
  await act(async () => root!.root.findByProps({ accessibilityLabel: '確認が必要な詳細' }).props.onClick());
};

describe('新規人物だけの編集可能な初期値', () => {
  it('キャラ選択は補助文なしで表示し、任意入力の案内を基本グループ直下に置く', async () => {
    await render();

    expect(root!.root.findAllByType('RecordPicker')[0]?.props.helperText).toBeUndefined();
    const rendered = JSON.stringify(root!.toJSON());
    expect(rendered.indexOf('基本')).toBeLessThan(rendered.indexOf('すべての項目を埋める必要はありません'));
    expect(rendered.indexOf('すべての項目を埋める必要はありません')).toBeLessThan(rendered.indexOf('性別表現'));
  });

  it('通常のキャラ一覧では写真カードから未保存編集保護を経て選択する', async () => {
    await render();
    const thumbnailPicker = root!.root.findByType('CharacterThumbnailPicker');

    expect(thumbnailPicker.props.characters).toEqual([entity]);
    expect(thumbnailPicker.props.selectedId).toBeNull();
    await act(async () => thumbnailPicker.props.onSelect(entity.id));

    expect(saveDirtyEditors).toHaveBeenCalledTimes(1);
    expect(updateSelection).toHaveBeenCalledWith({ entityId: entity.id }, { skipDirtyCheck: true });
  });

  it('保存済みの顔・髪・服の値は選択時に折り畳まず表示する', async () => {
    selection.entityId = entity.id;
    entity = {
      ...entity,
      structured_fields: { face_shape: 'round', hair_color: 'black', clothing_category: 'school' },
    };
    entityDetail = entity;
    pages = [{ entities: [entity] }];
    await render();

    for (const label of ['顔', '髪', '服装']) {
      expect(root!.root.findAllByType('button').find((node) => node.props.accessibilityLabel === label)!.props.accessibilityState.expanded).toBe(true);
    }
    expect(choice('髪の色').props.value).toBe('black');
  });

  it('キャラ一覧の初期データがない読み込み失敗だけを必須エラーとして表示する', async () => {
    entitiesError = new Error('offline');
    pages = [{ entities: [] }];
    await render();

    const failure = root!.root.findAllByType('ActionableErrorNotice').find((node) => node.props.context.operation === 'loadCharacters')!;
    expect(failure.props.context.essential).toBe(true);
  });

  it('新規人物は六つの基本初期値を表示し、未編集ならdirtyにも自動保存にもならない', async () => {
    await render();
    expect(defaultLabels.map(label => choice(label).props.value)).toEqual(Object.values(expectedDefaults));
    expect(registration.dirty).toBe(false);
    expect(createEntity).not.toHaveBeenCalled();
    expect(updateEntity).not.toHaveBeenCalled();
    const detailGroups = root!.root.findAllByType('button').filter(node =>
      ['顔', '髪', '服装'].includes(node.props.accessibilityLabel));
    expect(detailGroups).toHaveLength(3);
    expect(detailGroups.every(node => node.props.accessibilityState.expanded === false)).toBe(true);
  });

  it('明示選択した話の候補だけを新規下書きへ反映し、人物presetを混ぜない', async () => {
    suggestEpisodeCharacters.mockResolvedValueOnce({
      version: 3,
      characters: [{
        name: '澪', name_quote: '澪は窓辺に立った。', entity_type: 'character', status: 'new', entity_ids: [],
        appearance: [
          { field: 'hair_color', value: '黒', quote: '黒髪が風になびく。' },
          { field: 'features', value: '赤いスカーフ', quote: '赤いスカーフを巻く。' },
        ], changes: [],
      }],
    });
    await render();
    await act(async () => root!.root.findAllByType('PrimaryButton').find(node => node.props.label === 'この話から候補を作る')!.props.onPress());
    await act(async () => root!.root.findByProps({ accessibilityLabel: '澪の候補を選択' }).props.onPress());

    expect(getEpisodes).toHaveBeenCalledWith('chapter', null);
    expect(suggestEpisodeCharacters).toHaveBeenCalledWith('episode', { version: 3 }, null);
    expect(field('名前').props.value).toBe('澪');
    expect(root!.root.findAllByType('button').find(node => node.props.accessibilityLabel === '髪')!.props.accessibilityState.expanded).toBe(true);
    expect(choice('髪の色').props.value).toBe('黒');
    expect(choice('性別表現').props.value).toBe('');
    expect(field('自由入力欄').props.value).toBe('赤いスカーフ');
  });

  it('初期値を消す操作もdirtyとなり、明示保存時だけ編集後の表示値を送る', async () => {
    await render();
    await act(async () => choice('性別表現').props.onChange(''));
    expect(registration.dirty).toBe(true);
    await rerender();
    expect(choice('性別表現').props.value).toBe('');
    await act(async () => field('名前').props.onChangeText('New hero'));
    expect(createEntity).not.toHaveBeenCalled();
    await act(async () => registration.save());
    const remainingDefaults: Partial<typeof expectedDefaults> = { ...expectedDefaults };
    delete remainingDefaults.gender_expression;
    expect(createEntity).toHaveBeenCalledWith('work', {
      entity_type: 'character', name: 'New hero', free_description: null,
      prompt_supplement: null, speech_profile: {}, structured_fields: remainingDefaults,
    }, null);
  });

  it('同じscopeの一覧再取得や折畳みを行っても編集中の初期値を上書きしない', async () => {
    await render();
    await act(async () => choice('第一印象').props.onChange('quiet_neat'));
    pages = [{ entities: [{ ...entity, name: 'Refetched' }] }];
    await rerender();
    const face = root!.root.findAllByType('button').find(node => node.props.accessibilityLabel === '顔')!;
    await act(async () => face.props.onPress());
    expect(choice('第一印象').props.value).toBe('quiet_neat');
    expect(registration.dirty).toBe(true);
  });

  it.each(['nonhuman', 'object'])('新規%sへ種類を変更しても人物presetを送らず戻った編集値を保つ', async (type) => {
    await render();
    await act(async () => choice('性別表現').props.onChange(''));
    await act(async () => choice('年齢帯').props.onChange('ageless'));
    await changeType(type);
    expect(registration.dirty).toBe(false);
    await changeType('character');
    expect(choice('性別表現').props.value).toBe('');
    expect(choice('年齢帯').props.value).toBe('ageless');
    await changeType(type);
    await act(async () => field('名前').props.onChangeText('Other asset'));
    await act(async () => registration.save());
    expect(createEntity.mock.lastCall?.[1]).toMatchObject({ entity_type: type, structured_fields: {} });
  });

  it('別の保存済み空欄人物を再度開いても初期値を補完しない', async () => {
    await render();
    selection.entityId = entity.id;
    await rerender();
    expect(defaultLabels.map(label => choice(label).props.value)).toEqual(['', '', '', '', '', '']);
    expect(registration.dirty).toBe(false);
    await openNew();
    expect(choice('性別表現').props.value).toBe('male');
    selection.entityId = entity.id;
    await rerender();
    await act(async () => field('名前').props.onChangeText('Renamed saved hero'));
    await act(async () => registration.save());
    expect(updateEntity.mock.lastCall?.[1]).toEqual({ name: 'Renamed saved hero', expected_updated_at: 'revision' });
    expect(entity.structured_fields).toMatchObject({ gender_expression: '', age_range: null });
  });


  it.each(['nonhuman', 'object'])('新規人物から保存済み%sへ移動しても種類固有の値を落とさない', async (type) => {
    entity = { ...entity, entity_type: type, structured_fields: type === 'nonhuman'
      ? { base_form: 'dragon', size: 'large' } : { category: 'tool', size: 'large' } } as EntityRecord;
    pages = [{ entities: [entity] }];
    await render();
    selection.entityId = entity.id;
    await rerender();
    expect(root!.root.findByType('SegmentedControl').props.value).toBe(type);
    expect(root!.root.findAllByType('FormField').some(node => node.props.value === (type === 'nonhuman' ? 'dragon' : 'tool'))).toBe(true);
    expect(registration.dirty).toBe(false);
    await act(async () => field('名前').props.onChangeText('Renamed other asset'));
    await act(async () => registration.save());
    expect(updateEntity.mock.lastCall?.[1]).toEqual({ name: 'Renamed other asset', expected_updated_at: 'revision' });
  });

  it('保存済みレコードの取得待ちには新規presetを表示しない', async () => {
    selection.entityId = 'loading-record';
    pages = [{ entities: [] }];
    await render();
    expect(root!.root.findAllByType('CharacterChoiceField')).toHaveLength(0);
    expect(registration.dirty).toBe(false);
  });


  it('保存済み人物の取得待ちは編集入口を出さず、読込後の入力は保持する', async () => {
    selection.entityId = entity.id;
    pages = [{ entities: [] }];
    await render();
    const loadingInputs = root!.root.findAllByType('FormField');
    const loadingName = loadingInputs.find(node => node.props.label === '名前');
    if (loadingName !== undefined && loadingName.props.editable !== false) {
      await act(async () => loadingName.props.onChangeText('Typed while loading'));
    }
    entityDetail = entity;
    await rerender();
    expect(loadingInputs).toHaveLength(0);
    expect(field('名前').props.value).toBe('Saved hero');
    await act(async () => field('名前').props.onChangeText('Typed after loading'));
    entityDetail = { ...entity, name: 'Refetched name' };
    await rerender();
    expect(field('名前').props.value).toBe('Typed after loading');
    expect(registration.dirty).toBe(true);
  });


  it.each(['ja', 'en'] as const)('%sで取得待ちを明示し、失敗時は再読込または新規作成へ戻れる', async (locale) => {
    language = locale;
    selection.entityId = entity.id;
    pages = [{ entities: [] }];
    await render();
    const loading = root!.root.findAllByType('Notice').map(node => node.props.message).join(' ');
    expect(loading).toContain(locale === 'ja' ? '読み込み中' : 'Loading');
    expect(root!.root.findAllByType('FormField')).toHaveLength(0);
    expect(root!.root.findAllByType('CharacterChoiceField')).toHaveLength(0);
    expect(root!.root.findAllByType('QuotedEntityImport')).toHaveLength(0);
    entityDetailError = new Error('offline');
    await rerender();
    expect(root!.root.findAllByType('FormField')).toHaveLength(0);
    const failure = root!.root.findAllByType('ActionableErrorNotice').find(node => node.props.context.operation === 'loadCharacters')!;
    await act(async () => failure.props.actions.retry());
    expect(refetchEntity).toHaveBeenCalledOnce();
    await openNew();
    expect(root!.root.findAllByType('FormField').some(node => node.props.label === (locale === 'ja' ? '名前' : 'Name'))).toBe(true);
    expect(root!.root.findAllByType('CharacterChoiceField').some(node => node.props.value === 'male')).toBe(true);
  });

  it('画像import結果の空欄は新規presetで補完されず明示保存でその値を使う', async () => {
    await render();
    const importControl = root!.root.findByType('QuotedEntityImport');
    await act(async () => importControl.props.onApply({
      suggested_fields: { gender_expression: 'female', character_identity: { aliases: ['Import, Hero'] } },
      prompt_supplement: 'Imported prompt', tmp_image_token: 'candidate',
    }, importControl.props.draftRevision));
    expect(choice('性別表現').props.value).toBe('female');
    expect(choice('年齢帯').props.value).toBe('');
    await rerender();
    await act(async () => field('名前').props.onChangeText('Imported hero'));
    await act(async () => registration.save());
    expect(createEntity.mock.lastCall?.[1].structured_fields).toEqual({
      gender_expression: 'female', character_identity: { aliases: ['Import, Hero'] },
    });
  });

  it('新規draftの画像importは既存の保存経路を一度だけ完了して保存済みentityで再開する', async () => {
    // Design: paid image analysis must start only after the draft has one stable,
    // owned entity id; the resumed picker is scoped to that persisted record.
    await render();
    await act(async () => field('名前').props.onChangeText('Imported hero'));
    const importControl = root!.root.findByType('QuotedEntityImport');

    await act(async () => {
      await Promise.all([
        importControl.props.onRequireSavedEntity(),
        importControl.props.onRequireSavedEntity(),
      ]);
    });

    expect(createEntity).toHaveBeenCalledOnce();
    expect(updateSelection).toHaveBeenCalledWith(
      { entityId: 'created' },
      { skipDirtyCheck: true },
    );

    const created = { ...entity, id: 'created', name: 'Imported hero' };
    pages = [{ entities: [created] }];
    await rerender();
    const resumedImport = root!.root.findByType('QuotedEntityImport');
    expect(resumedImport.props.entityId).toBe('created');
    expect(resumedImport.props.autoStart).toBe(true);

    await act(async () => resumedImport.props.onAutoStartConsumed());
    await rerender();
    expect(root!.root.findByType('QuotedEntityImport').props.autoStart).toBe(false);
  });

  it.each(['work', 'organization', 'session'] as const)('%s変更中に画像import用の保存が完了しても現在の選択を汚染せず再開しない', async (scope) => {
    // A late create response belongs to the workspace that started it. It must
    // neither select that entity in the new workspace nor resume its picker.
    let finishCreate: ((value: EntityRecord) => void) | undefined;
    createEntity.mockImplementationOnce(() => new Promise<EntityRecord>((resolve) => { finishCreate = resolve; }));
    await render();
    await act(async () => field('名前').props.onChangeText('Imported hero'));
    const pending = root!.root.findByType('QuotedEntityImport').props.onRequireSavedEntity();
    await act(async () => { await Promise.resolve(); });

    if (scope === 'work') selection.workId = 'other-work';
    if (scope === 'organization') selection.organizationId = 'organization';
    if (scope === 'session') sessionKey = 'other-user';
    await rerender();
    await act(async () => {
      finishCreate?.({ ...entity, id: 'late-created', name: 'Imported hero' });
      await pending;
    });
    await rerender();

    expect(selection.entityId).toBeNull();
    expect(updateSelection).not.toHaveBeenCalledWith(
      { entityId: 'late-created' },
      { skipDirtyCheck: true },
    );
    expect(root!.root.findAllByType('QuotedEntityImport').some(node => node.props.autoStart === true)).toBe(false);
  });

  it.each(['work', 'organization', 'session'])('%sを変更した新規formは旧draftを引き継がず別の初期値から始まる', async (scope) => {
    await render();
    await act(async () => field('名前').props.onChangeText('Old scope draft'));
    await act(async () => choice('性別表現').props.onChange('female'));
    if (scope === 'work') selection.workId = 'other-work';
    if (scope === 'organization') selection.organizationId = 'organization';
    if (scope === 'session') sessionKey = 'other-user';
    await rerender();
    expect(field('名前').props.value).toBe('');
    expect(choice('性別表現').props.value).toBe('male');
    expect(registration.dirty).toBe(false);
    expect(createEntity).not.toHaveBeenCalled();
  });


  it('work変更前に開始したimport結果は同じ初期値の新規formへ適用しない', async () => {
    await render();
    const staleImport = root!.root.findByType('QuotedEntityImport').props;
    selection.workId = 'other-work';
    await rerender();
    await act(async () => staleImport.onApply({ suggested_fields: { gender_expression: 'female' },
      prompt_supplement: 'Old scope', tmp_image_token: 'old-candidate' }, staleImport.draftRevision));
    expect(choice('性別表現').props.value).toBe('male');
    expect(registration.dirty).toBe(false);
  });


  it('新規作成を開き直した後は以前の同値formのimport結果を適用しない', async () => {
    await render();
    const staleImport = root!.root.findByType('QuotedEntityImport').props;
    await openNew();
    await act(async () => staleImport.onApply({ suggested_fields: { gender_expression: 'female' },
      prompt_supplement: 'Previous draft', tmp_image_token: 'old-candidate' }, staleImport.draftRevision));
    expect(choice('性別表現').props.value).toBe('male');
    expect(registration.dirty).toBe(false);
  });

  it('新規入力の破棄は初期値へ戻り、dirty guard拒否時は入力が残る', async () => {
    await render();
    await act(async () => choice('性別表現').props.onChange('female'));
    resolveDirtyEditors.mockResolvedValueOnce(false);
    await openNew();
    expect(choice('性別表現').props.value).toBe('female');
    expect(updateSelection).not.toHaveBeenCalled();
    await act(async () => registration.discard());
    expect(choice('性別表現').props.value).toBe('male');
    expect(registration.dirty).toBe(false);
  });

  it('画像生成ジョブが見つからない場合は古い監視対象を外して再生成を妨げない', async () => {
    selection.entityId = entity.id;
    await render();
    const options = assetQuoteCapture.options as {
      contextKey: string;
      onAccepted: (receipt: { job_id: string }, target: { request: { target_id: string } }, originKey: string) => Promise<void>;
    };
    await act(async () => {
      await options.onAccepted(
        { job_id: 'expired-job' },
        { request: { target_id: entity.id } },
        options.contextKey,
      );
    });
    const status = root!.root.findByType('JobStatusCard');
    expect(status.props.jobId).toBe('expired-job');
    await act(async () => { await status.props.onMissing(); });
    expect(root!.root.findByType('JobStatusCard').props.jobId).toBeNull();
  });

  it('保存型autofillは保存済み人物を重複表示せず、スキップ情報だけをレビュー詳細に残す', async () => {
    characterAutofillEnabled = true;
    const autofilledEntity = {
      ...entity,
      id: '00000000-0000-4000-8000-000000000002',
      name: '澪',
      structured_fields: { hair_color: 'black' },
    };
    pages = [{ entities: [entity, autofilledEntity] }];
    autofillEpisodeCharacters.mockResolvedValueOnce({
      version: 3,
      characters: [
        { entity_id: entity.id, name: 'Saved hero', created: false, states_added: 2 },
        { entity_id: '00000000-0000-4000-8000-000000000002', name: '澪', created: true, states_added: 1 },
      ],
      skipped_names: ['通行人'],
    });
    await render();
    await act(async () => root!.root.findByProps({ testID: 'character-autofill-save-all' }).props.onPress());

    expect(getEpisodes).toHaveBeenCalledWith('chapter', null);
    expect(autofillEpisodeCharacters).toHaveBeenCalledWith('episode', { version: 3 }, null);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['entities', sessionKey, 'work', 'personal'] });
    expect(root!.root.findAllByType('Section').some((node) => node.props.title === '確認が必要な詳細')).toBe(true);
    expect(JSON.stringify(root!.toJSON())).not.toContain('通行人');
    expect(root!.root.findAllByProps({ testID: `character-autofill-edit-${autofilledEntity.id}` })).toHaveLength(0);
    expect(JSON.stringify(root!.toJSON())).not.toContain('新規保存・状態を1件追加');
    await openAutofillReview();
    expect(JSON.stringify(root!.toJSON())).toContain('通行人');

    await act(async () => root!.root.findByType('CharacterThumbnailPicker').props.onSelect(autofilledEntity.id));
    await rerender();
    expect(updateSelection).toHaveBeenCalledWith({ entityId: autofilledEntity.id }, { skipDirtyCheck: true });
    expect(choice('性別表現').props.value).toBe('');
    expect(root!.root.findAllByType('button').find(node => node.props.accessibilityLabel === '髪')!.props.accessibilityState.expanded).toBe(true);
    expect(choice('髪の色').props.value).toBe('black');
    await act(async () => field('名前').props.onChangeText('保存し直した澪'));
    await act(async () => registration.save());
    expect(updateEntity.mock.lastCall?.[1]).toEqual({
      name: '保存し直した澪',
      expected_updated_at: 'revision',
    });
  });

  it('保存型autofillは未保存の人物編集を解決できない間は書き込まない', async () => {
    characterAutofillEnabled = true;
    saveDirtyEditors.mockResolvedValueOnce(false);
    await render();
    await act(async () => root!.root.findByProps({ testID: 'character-autofill-save-all' }).props.onPress());

    expect(autofillEpisodeCharacters).not.toHaveBeenCalled();
    expect(resolveDirtyEditors).not.toHaveBeenCalled();
  });

  it('空欄候補は根拠を表示し、明示的に選んだ項目だけを順に反映する', async () => {
    characterAutofillEnabled = true;
    const initialRevision = '2026-11-20T00:00:00.000Z';
    const firstRevision = '2026-11-20T00:01:00.000Z';
    const secondRevision = '2026-11-20T00:02:00.000Z';
    autofillEpisodeCharacters.mockResolvedValueOnce({
      version: 3, characters: [], skipped_names: [], appearance_review: {
        suggestions: [
          { entity_id: entity.id, name: entity.name, field: 'hair.color', value: 'black', quote: '黒髪が風になびいた。', expected_updated_at: initialRevision },
          { entity_id: entity.id, name: entity.name, field: 'hair.color', value: 'black', quote: '漆黒の髪が光った。', expected_updated_at: initialRevision },
          { entity_id: entity.id, name: entity.name, field: 'eyes.color', value: 'blue', quote: '青い目が光った。', expected_updated_at: initialRevision },
        ],
        unresolved: [{ quote: '影の中に赤い光があった。', reason: 'unverified_trait' }],
      },
    });
    approveCharacterAppearance
      .mockResolvedValueOnce({ ...entity, updated_at: firstRevision })
      .mockResolvedValueOnce({ ...entity, updated_at: secondRevision });
    await render();
    await act(async () => root!.root.findByProps({ testID: 'character-autofill-save-all' }).props.onPress());

    expect(root!.root.findAllByProps({ testID: 'appearance-review-unresolved' })).toHaveLength(0);
    await openAutofillReview();
    expect(JSON.stringify(root!.toJSON())).toContain('髪の色');
    expect(JSON.stringify(root!.toJSON())).toContain('候補: 黒');
    expect(JSON.stringify(root!.toJSON())).toContain('本文: 「黒髪が風になびいた。」');
    expect(root!.root.findAllByProps({ testID: 'appearance-review-unresolved' })).toHaveLength(1);

    const hairActions = root!.root.findAllByType('PrimaryButton').filter((node) =>
      node.props.testID === `appearance-review-apply-${entity.id}-hair.color`);
    expect(hairActions).toHaveLength(2);
    await act(async () => hairActions[0]!.props.onPress());
    expect(approveCharacterAppearance).toHaveBeenNthCalledWith(1, expect.objectContaining({
      field: 'hair.color', expected_updated_at: initialRevision,
    }), null);
    expect(root!.root.findAllByProps({ testID: `appearance-review-apply-${entity.id}-hair.color` })).toHaveLength(0);

    await act(async () => root!.root.findByProps({ testID: `appearance-review-apply-${entity.id}-eyes.color` }).props.onPress());
    expect(approveCharacterAppearance).toHaveBeenNthCalledWith(2, expect.objectContaining({
      field: 'eyes.color', expected_updated_at: firstRevision,
    }), null);
  });
});
