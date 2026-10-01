import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityStateEditor } from '@/components/EntityStateEditor';
const test = vi.hoisted(() => ({ api: { saveNamedEntityState: vi.fn(), generateEntityStateReference: vi.fn(), confirmEntityStateReference: vi.fn(), createGenerationQuote: vi.fn(), acceptGenerationQuote: vi.fn(), getGenerationQuote: vi.fn() }, session: {} as Record<string, unknown>, states: [] as unknown[], jobs: [] as unknown[], confirmation: null as null | { onConfirm: () => void }, dirtyRegistration: null as unknown, trackJob: vi.fn(async () => undefined), queryClient: { invalidateQueries: vi.fn(async () => undefined), setQueryData: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/lib/config', () => ({ config: { apiBaseUrl: 'https://api.example' } }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api: test.api, language: 'ja', session: test.session, selection: { organizationId: null }, sessionKey: 'session', tokens: null, trackJob: test.trackJob, hasCapability: () => true }) }));
vi.mock('@/state/dirtyState', () => ({ useDirtyEditorRegistration: (input: unknown) => { test.dirtyRegistration = input; }, useDirtyState: () => ({ resolveDirtyEditors: async () => true }) }));
vi.mock('@/lib/confirm', () => ({ confirmAction: (input: { onConfirm: () => void }) => { test.confirmation = input; } }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => test.queryClient, useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === 'entity-states' ? { entity_states: test.states } : queryKey[0] === 'entity-reference-set' ? { primary_ref_id: 'base', status: 'ready', reference_images: [{ ref_id: 'base', source: 'generated', created_at: '2026-01-01T00:00:00Z' }], updated_at: '2026-01-01T00:00:00Z' } : queryKey[0] === 'entity-state-jobs' ? test.jobs : queryKey[0] === 'job' ? test.jobs[0] : undefined, isSuccess: true, isPending: false, error: null, refetch: vi.fn(async () => ({ data: test.jobs })) }) }));
vi.mock('react-native', () => ({ Pressable: 'button', Text: 'text', View: 'view', StyleSheet: { create: (styles: unknown) => styles } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000001' }));
vi.mock('@/components/AssetGenerationQuoteDialog', () => ({ AssetGenerationQuoteDialog: 'quote-dialog' }));
vi.mock('@/components/FormField', () => ({ FormField: 'field' }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: 'action' }));
vi.mock('@/components/RecordPicker', () => ({ RecordPicker: 'picker' }));
vi.mock('@/components/Notice', () => ({ Notice: 'notice' }));
vi.mock('@/components/Section', () => ({ Section: 'section' }));
vi.mock('@/components/ResilientImage', () => ({ ResilientImage: 'image' }));
vi.mock('@/components/JobStatusCard', () => ({ JobStatusCard: 'job-card' }));
const state = { id: 'state', entity_id: 'entity', name: '外傷', description: '左頬に傷', scene_id: null, costume_note: 'legacy', costume_ref_id: 'old', condition_note: null, hair_note: null, expression_default: 'calm', extra_note: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', reference_status: 'draft' };
const entity = { id: 'entity', work_id: 'work', entity_type: 'character' as const, name: 'アキラ', free_description: null, structured_fields: {}, prompt_supplement: null, speech_profile: {}, status: 'ready' as const, created_at: state.created_at, updated_at: state.created_at };
describe('EntityStateEditor', () => {
  beforeEach(() => { vi.clearAllMocks(); test.states = [state]; test.jobs = []; test.session = {}; test.confirmation = null;
    test.api.createGenerationQuote.mockResolvedValue({ quote_id: 'quote', quote_token: 'opaque', operation: 'entity_state_preview', target_id: 'state', billing_scope: { kind: 'personal', organization_id: null }, image_model: 'gpt-image-2', quality: 'medium', render_style: 'color', amount_credits: 7, reference_count: 1, expires_at: '2099-01-01T00:00:00Z', blockers: [] });
    test.api.acceptGenerationQuote.mockResolvedValue({ quote_id: 'quote', job_id: 'job', accepted_at: state.created_at, amount_credits: 7 });
    test.api.getGenerationQuote.mockResolvedValue({ quote_id: 'quote', job_id: null, accepted_at: null, amount_credits: 7 });
  });
  const render = (existing = true) => { let renderer!: ReturnType<typeof create>; act(() => { renderer = create(<EntityStateEditor entity={entity} parentDirty={false} parentBusy={false} availableCredits={10} initialCandidate={existing ? { entityId: 'entity', stateId: 'state', name: '別の候補名', description: '上書きしない' } : undefined} />); }); return renderer; };
  const action = (renderer: ReturnType<typeof create>, label: string) => renderer.root.findAllByType('action').find((node) => node.props.label === label)!;
  it('能力のない旧APIでは有料previewを無効化し既存IDの編集候補はserver値を表示する', () => {
    const renderer = render();
    expect(renderer.root.findAllByType('field').find((node) => node.props.label === '状態名')?.props.value).toBe('外傷');
    const preview = renderer.root.findAllByType('action').find((node) => node.props.label.startsWith('プレビュー'))!;
    expect(preview.props.disabled).toBe(true); expect(test.api.generateEntityStateReference).not.toHaveBeenCalled();
  });
  it('保存は名前と説明だけを更新しlegacyや基本参照を消さない', async () => {
    const renderer = render(); test.api.saveNamedEntityState.mockResolvedValue({ ...state, name: '治療後' });
    act(() => renderer.root.findAllByType('field').find((node) => node.props.label === '状態名')!.props.onChangeText('治療後'));
    await act(async () => { await action(renderer, '状態を保存').props.onPress(); });
    expect(test.api.saveNamedEntityState).toHaveBeenCalledWith('entity', 'state', { name: '治療後', description: '左頬に傷' }, null);
    expect(test.api.generateEntityStateReference).not.toHaveBeenCalled();
  });
  it('server見積の7クレジットを確認してからのみ受付し旧previewAPIを呼ばない', async () => {
    test.session = { capabilities: { entity_state_reference_generation: true, generation_quotes: true } };
    const renderer = render();
    await act(async () => { await action(renderer, 'プレビュー料金を確認').props.onPress(); });
    expect(test.api.createGenerationQuote).toHaveBeenCalledWith({ operation: 'entity_state_preview', target_id: 'state', entity_id: 'entity' }, null);
    expect(test.api.acceptGenerationQuote).not.toHaveBeenCalled();
    expect(renderer.root.findByType('quote-dialog').props.state.quote.amount_credits).toBe(7);
    await act(async () => { renderer.root.findByType('quote-dialog').props.onAccept(); renderer.root.findByType('quote-dialog').props.onAccept(); });
    expect(test.api.acceptGenerationQuote).toHaveBeenCalledOnce();
    expect(test.api.generateEntityStateReference).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
  it('状態専用の候補を明示選択してからtokenとrevisionで確定する', async () => {
    test.jobs = [{ id: 'job', job_type: 'entity_generate', status: 'completed', created_at: state.created_at,
      params: { target: 'entity_state', entity_id: 'entity', entity_state_id: 'state', state_revision: state.updated_at },
      result: { provider_result: true, candidates: [{ candidate_token: 'signed-state-token' }] } }];
    test.api.confirmEntityStateReference.mockResolvedValue({});
    const renderer = render();
    expect(action(renderer, '選択した候補を状態画像に確定').props.disabled).toBe(true);
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { await action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledWith('entity', 'state', { candidate_token: 'signed-state-token', expected_state_revision: state.updated_at }, null);
    expect(test.api.generateEntityStateReference).not.toHaveBeenCalled();
  });
  it('古いpreview確認後に入力が変わった場合は課金操作を送らない', async () => {
    test.session = { capabilities: { entity_state_reference_generation: true, generation_quotes: true } };
    const renderer = render();
    await act(async () => { action(renderer, 'プレビュー料金を確認').props.onPress(); });
    act(() => renderer.root.findAllByType('field').find((node) => node.props.label === '自由入力')!.props.onChangeText('未保存変更'));
    await act(async () => { renderer.root.findByType('quote-dialog').props.onAccept(); });
    expect(test.api.acceptGenerationQuote).not.toHaveBeenCalled();
    expect(test.api.generateEntityStateReference).not.toHaveBeenCalled();
  });
  it('preview通信断でも旧確定画像を残し自動再課金せず照合を案内する', async () => {
    test.session = { capabilities: { entity_state_reference_generation: true, generation_quotes: true } };
    test.states = [{ ...state, reference_status: 'confirmed', reference_image: { ref_id: 'old-state-ref', base_ref_id: 'base', created_at: state.created_at } }];
    test.api.acceptGenerationQuote.mockRejectedValue(new Error('offline'));
    const renderer = render();
    const before = renderer.root.findAllByType('image').length;
    await act(async () => { action(renderer, 'プレビュー料金を確認').props.onPress(); });
    await act(async () => { renderer.root.findByType('quote-dialog').props.onAccept(); });
    expect(renderer.root.findAllByType('image')).toHaveLength(before);
    expect(JSON.stringify(renderer.toJSON())).toContain('受付結果が不明');
    expect(test.api.acceptGenerationQuote).toHaveBeenCalledTimes(1);
    expect(action(renderer, 'プレビュー料金を確認').props.disabled).toBe(true);
  });
  it('未保存入力があるとpreviewせずdirty guardへ登録する', () => {
    test.session = { capabilities: { entity_state_reference_generation: true, generation_quotes: true } };
    const renderer = render();
    act(() => renderer.root.findAllByType('field').find((node) => node.props.label === '自由入力')!.props.onChangeText('変更'));
    expect(action(renderer, 'プレビュー料金を確認').props.disabled).toBe(true);
    expect(test.dirtyRegistration).toMatchObject({ dirty: true });
  });
});
