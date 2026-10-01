import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CharactersScreen } from '@/screens/CharactersScreen';
import type { EntityRecord } from '@/domain/types';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReactTestRenderer | undefined;
let entity: EntityRecord;
let pages: { entities: EntityRecord[] }[];
let registration: {dirty:boolean;save:()=>Promise<void>;discard:()=>void};
const updateEntity=vi.fn(); const navigate=vi.fn();
const queryClient={invalidateQueries:vi.fn(),fetchQuery:vi.fn()};
const query=(data:unknown):Record<string,unknown>=>({data,error:null,isFetching:false,refetch:vi.fn()});
vi.mock('react-native',()=>({Pressable:'button',ScrollView:'scroll',View:'view',Text:'text',StyleSheet:{create:<T,>(styles:T):T=>styles}}));
vi.mock('@react-navigation/native',()=>({useNavigation:()=>({navigate})}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>queryClient,
 useInfiniteQuery:()=>({...query({pages}),hasNextPage:false,isFetchingNextPage:false,fetchNextPage:vi.fn()}),
 useQuery:()=>query(undefined),
 useMutation:(options:{mutationFn:()=>Promise<unknown>;onSuccess?:(value:unknown)=>Promise<void>;onError?:(error:unknown)=>void})=>{
 const run=async():Promise<unknown>=>{try{const value=await options.mutationFn();await options.onSuccess?.(value);return value;}catch(error){options.onError?.(error);throw error;}};
 return {mutateAsync:run,mutate:()=>{void run();},isPending:false,error:null};}
}));
vi.mock('@/state/appState',()=>({useAppState:()=>({api:{updateEntity},hasCapability:()=>true,language:'ja',logout:vi.fn(),selection:{workId:'work',entityId:'entity',organizationId:null},session:{organizations:[],capabilities:{}},sessionKey:'user',tokens:null,trackJob:vi.fn(),updateSelection:vi.fn()})}));
vi.mock('@/state/dirtyState',()=>({useDirtyState:()=>({resolveDirtyEditors:vi.fn().mockResolvedValue(true)}),useDirtyEditorRegistration:(input:typeof registration)=>{registration=input;}}));
vi.mock('@/hooks/useActiveResourceJobId',()=>({useActiveResourceJobId:()=>null}));
vi.mock('@/hooks/useAssetGenerationQuote',()=>({useAssetGenerationQuote:()=>({state:{phase:'closed',visible:false},controller:{open:vi.fn(),close:vi.fn(),accept:vi.fn(),reconcile:vi.fn(),canAccept:()=>false}})}));
vi.mock('@/components/WorkspaceContextPicker',()=>({useWorkspaceContextSelection:()=>({selectedWorkId:'work',selectedEpisodeId:'episode'})}));
vi.mock('@/lib/config',()=>({config:{apiBaseUrl:'https://example.test'}}));
vi.mock('@/lib/api',()=>({ApiError:class ApiError extends Error{}}));
vi.mock('@/lib/download',()=>({appendOrganizationQuery:vi.fn(),downloadAuthenticatedFile:vi.fn()}));
vi.mock('@/lib/confirm',()=>({confirmAction:vi.fn(),confirmDestructiveAction:vi.fn()}));
vi.mock('@/lib/confirmStaleDraftReload',()=>({confirmStaleDraftReload:vi.fn()}));
vi.mock('@/components/Screen',()=>({Screen:({children}:{children:React.ReactNode})=>children}));
vi.mock('@/components/Section',()=>({Section:({children}:{children:React.ReactNode})=>children}));
vi.mock('@/components/ActionableErrorNotice',()=>({ActionableErrorNotice:(props:Record<string,unknown>)=>React.createElement('ActionableErrorNotice',props)}));
vi.mock('@/components/CharacterChoiceField',()=>({CharacterChoiceField:(props:Record<string,unknown>)=>React.createElement('CharacterChoiceField',props)}));
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

beforeEach(()=>{
 entity={id:'entity',work_id:'work',name:'Hero',entity_type:'character',free_description:'saved description',prompt_supplement:null,speech_profile:{tone:'quiet'},structured_fields:{character_identity:{aliases:['Ace, Jr.','Old name'],visual_anchor:'red scarf'},proportions:{head_to_body_ratio:'7 heads'},gender_expression:'',age_range:''},updated_at:'revision'} as unknown as EntityRecord;
 pages=[{entities:[entity]}];updateEntity.mockReset().mockResolvedValue(entity);
});
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;});
const render=async():Promise<void>=>{await act(async()=>{root=create(<CharactersScreen/>);});};
describe('非表示alias・既存空欄と構造化値の実画面payload保全',()=>{
 it('alias入力を表示せず名前だけ保存した時は構造化値を送信しない',async()=>{
  await render();expect(root!.root.findAllByType('FormField').some(node=>/別名|alias/i.test(node.props.label))).toBe(false);
  const name=root!.root.findAllByType('FormField').find(node=>node.props.value==='Hero')!;
  await act(async()=>name.props.onChangeText('Renamed'));await act(async()=>{await registration.save();});
  expect(updateEntity.mock.lastCall?.[1]).toEqual({name:'Renamed',expected_updated_at:'revision'});
 });
 it('表示中の別項目を編集しても非表示alias・構造化field・保存済み空欄へpresetを上書きしない',async()=>{
  await render();const choice=root!.root.findAllByType('CharacterChoiceField').find(node=>node.props.label==='第一印象')!;
  expect(choice).toBeDefined();await act(async()=>choice.props.onChange('calm'));await act(async()=>{await registration.save();});
  const fields=updateEntity.mock.lastCall?.[1].structured_fields;
  expect(fields.character_identity.aliases).toEqual(['Ace, Jr.','Old name']);expect(fields.character_identity.visual_anchor).toBe('red scarf');expect(fields.proportions.head_to_body_ratio).toBe('7 heads');
  expect(fields.gender_expression??'').toBe('');expect(fields.age_range??'').toBe('');
 });
 it('自由入力保存は既存の1つのdirty guardを使いimportとconfirm入口を保持する',async()=>{
  await render();expect(registration.dirty).toBe(false);
  const detail=root!.root.findAllByType('FormField').find(node=>node.props.label==='自由入力欄')!;
  await act(async()=>detail.props.onChangeText('new details'));await act(async()=>{await registration.save();});
  expect(updateEntity.mock.lastCall?.[1]).toMatchObject({free_description:'new details'});
  expect(root!.root.findAllByType('QuotedEntityImport')).toHaveLength(1);
  expect(root!.root.findAllByType('PrimaryButton').some(node=>node.props.label==='候補画像を保存')).toBe(false);
  expect(root!.root.findAllByType('PrimaryButton').some(node=>node.props.label==='参照画像を確定')).toBe(true);
 });
});
