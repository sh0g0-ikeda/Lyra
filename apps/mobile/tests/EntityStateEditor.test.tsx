import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { EntityStateEditor } from '@/components/EntityStateEditor';
const test = vi.hoisted(() => ({ api: { getJob: vi.fn(), saveNamedEntityState: vi.fn(), generateEntityStateReference: vi.fn(), confirmEntityStateReference: vi.fn(), createGenerationQuote: vi.fn(), acceptGenerationQuote: vi.fn(), getGenerationQuote: vi.fn() }, session: {} as Record<string, unknown>, language: 'ja' as 'ja' | 'en', sessionKey: 'session', organizationId: null as string | null, states: [] as unknown[], jobs: [] as unknown[], confirmation: null as null | { onConfirm: () => void }, dirtyRegistration: null as unknown, resolveDirtyEditors: vi.fn(async () => true), trackJob: vi.fn(async () => undefined), queryClient: { getQueryData: vi.fn(), invalidateQueries: vi.fn(async () => undefined), setQueryData: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/lib/config', () => ({ config: { apiBaseUrl: 'https://api.example' } }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api: test.api, language: test.language, session: test.session, selection: { organizationId: test.organizationId }, sessionKey: test.sessionKey, tokens: null, trackJob: test.trackJob, hasCapability: () => true }) }));
vi.mock('@/state/dirtyState', () => ({ useDirtyEditorRegistration: (input: unknown) => { test.dirtyRegistration = input; }, useDirtyState: () => ({ resolveDirtyEditors: test.resolveDirtyEditors }) }));
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
const confirmationReceipt = {
  entity_id: 'entity', state_id: 'state', state_revision: '2026-01-02T00:00:00Z',
  reference_image: { ref_id: 'new-state-ref', base_ref_id: 'base', image_model: 'gpt-image-2', created_at: state.created_at, input_fingerprint: 'a'.repeat(64) }
};
const completedPreview = { id: 'job', job_type: 'entity_generate', status: 'completed', created_at: state.created_at,
  params: { target: 'entity_state', entity_id: 'entity', entity_state_id: 'state', state_revision: state.updated_at },
  result: { provider_result: true, candidates: [{ candidate_token: 'signed-state-token' }] } };
const deferred = <T,>() => {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
};
describe('EntityStateEditor', () => {
  beforeEach(() => { vi.resetAllMocks(); test.language = 'ja'; test.sessionKey = 'session'; test.organizationId = null;
    test.queryClient.invalidateQueries.mockResolvedValue(undefined);
    test.queryClient.getQueryData.mockImplementation(() => ({ entity_states: test.states }));
    test.resolveDirtyEditors.mockResolvedValue(true);
    test.queryClient.setQueryData.mockImplementation((_key: unknown, updater: (previous: { entity_states: unknown[] }) => { entity_states: unknown[] }) => { test.states = updater({ entity_states: test.states }).entity_states; }); test.states = [state]; test.jobs = []; test.session = {}; test.confirmation = null;
    test.api.createGenerationQuote.mockResolvedValue({ quote_id: 'quote', quote_token: 'opaque', operation: 'entity_state_preview', target_id: 'state', billing_scope: { kind: 'personal', organization_id: null }, image_model: 'gpt-image-2', quality: 'medium', render_style: 'color', amount_credits: 7, reference_count: 1, expires_at: '2099-01-01T00:00:00Z', blockers: [] });
    test.api.acceptGenerationQuote.mockResolvedValue({ quote_id: 'quote', job_id: 'job', accepted_at: state.created_at, amount_credits: 7 });
    test.api.getJob.mockResolvedValue(completedPreview);
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
    test.api.confirmEntityStateReference.mockResolvedValue(confirmationReceipt);
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
  it.each(['ja', 'en'] as const)('保存応答後の読込失敗でも保存済みを認識して再送しない (%s)', async (language) => {
    test.language = language;
    const renderer = render();
    test.api.saveNamedEntityState.mockResolvedValue({ ...state, name: '治療後' });
    test.queryClient.invalidateQueries.mockRejectedValue(new Error('private server details'));
    act(() => renderer.root.findAllByType('field')[0]!.props.onChangeText('治療後'));
    const registration = test.dirtyRegistration as { save: () => Promise<void> };
    await act(async () => { await expect(registration.save()).resolves.toBeUndefined(); });
    const warning = renderer.root.findAllByType('notice').find((node) => node.props.tone === 'warning')!;
    expect(warning.props.message).toContain(language === 'ja' ? '状態は保存済みですが、最新表示の読み込みに失敗しました' : 'The state was saved, but refreshing the display failed');
    expect(warning.props.message).not.toContain('private server details');
    await act(async () => { await warning.props.onAction(); });
    expect(test.api.saveNamedEntityState).toHaveBeenCalledOnce();
    expect(test.queryClient.invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ queryKey: expect.any(Array) }), { throwOnError: true });
    expect(test.dirtyRegistration).toMatchObject({ dirty: false });
  });
  it.each(['ja', 'en'] as const)('確定応答後に読込が失敗しても受領した画像とrevisionを保持する (%s)', async (language) => {
    test.language = language; test.jobs = [completedPreview];
    test.states = [{ ...state, reference_status: 'confirmed', reference_image: { ...confirmationReceipt.reference_image, ref_id: 'old-state-ref' } }];
    test.api.confirmEntityStateReference.mockResolvedValue(confirmationReceipt);
    test.queryClient.invalidateQueries.mockRejectedValue(new Error('offline'));
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { await action(renderer, language === 'ja' ? '選択した候補を状態画像に確定' : 'Confirm selected state image').props.onPress(); });
    expect(test.states[0]).toMatchObject({ updated_at: confirmationReceipt.state_revision, reference_status: 'confirmed', reference_image: confirmationReceipt.reference_image });
    const output = JSON.stringify(renderer.toJSON());
    expect(output).toContain(language === 'ja' ? '状態画像は確定済みですが、最新表示の読み込みに失敗しました' : 'The state image was confirmed, but refreshing the display failed');
    expect(output).not.toContain(language === 'ja' ? '以前の確定画像は保持されています' : 'previous confirmed image is preserved');
    expect(output).toContain('new-state-ref');
    await act(async () => { await renderer.root.findAllByType('notice').find((node) => node.props.onAction)!.props.onAction(); });
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledOnce();
  });
  it('確定通信断では遠隔結果を断定せず旧表示と入力を残し再読込で変異を再送しない', async () => {
    test.jobs = [completedPreview];
    test.states = [{ ...state, reference_status: 'confirmed', reference_image: { ...confirmationReceipt.reference_image, ref_id: 'old-state-ref' } }];
    test.api.confirmEntityStateReference.mockRejectedValue(new Error('private token'));
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    const confirm = action(renderer, '選択した候補を状態画像に確定').props.onPress;
    await act(async () => { await confirm(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('状態画像の確定結果を確認できません');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('以前の確定画像は保持されています');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('private token');
    expect(JSON.stringify(renderer.toJSON())).toContain('old-state-ref');
    expect(action(renderer, '選択した候補を状態画像に確定').props.disabled).toBe(true);
    await act(async () => { await renderer.root.findAllByType('notice').find((node) => node.props.onAction)!.props.onAction(); await confirm(); });
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledOnce();
  });
  it('保存結果不明の新規状態は入力を残し一覧更新だけで作成を再送しない', async () => {
    const renderer = render(false);
    test.api.saveNamedEntityState.mockRejectedValue(new Error('offline'));
    act(() => { renderer.root.findAllByType('field')[0]!.props.onChangeText('外傷'); renderer.root.findAllByType('field')[1]!.props.onChangeText('左頬に傷'); });
    const save = action(renderer, '状態を保存').props.onPress;
    await act(async () => { await save(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('状態の保存結果を確認できません');
    expect(renderer.root.findAllByType('field')[0]!.props.value).toBe('外傷');
    expect(action(renderer, '状態を保存').props.disabled).toBe(true);
    await act(async () => { await renderer.root.findAllByType('notice').find((node) => node.props.onAction)!.props.onAction(); await save(); });
    expect(test.api.saveNamedEntityState).toHaveBeenCalledOnce();
  });
  it('保存応答後の読込中に編集した新しい入力を古い完了処理で置換しない', async () => {
    const refresh = deferred<void>();
    test.queryClient.invalidateQueries.mockReturnValue(refresh.promise);
    test.api.saveNamedEntityState.mockResolvedValue({ ...state, name: '治療後' });
    const renderer = render();
    act(() => renderer.root.findAllByType('field')[0]!.props.onChangeText('治療後'));
    let saving!: Promise<void>;
    await act(async () => { saving = action(renderer, '状態を保存').props.onPress(); });
    expect(renderer.root.findAllByType('field')[0]!.props.editable).toBe(true);
    act(() => renderer.root.findAllByType('field')[0]!.props.onChangeText('さらに編集'));
    await act(async () => { refresh.reject(new Error('offline')); await saving; });
    expect(renderer.root.findAllByType('field')[0]!.props.value).toBe('さらに編集');
    expect(test.dirtyRegistration).toMatchObject({ dirty: true });
  });
  it.each(['session', 'organization', 'entity'] as const)('応答待ちで%sが変わった場合は旧receiptを新しい編集画面へ反映しない', async (change) => {
    const mutation = deferred<typeof state>(); test.api.saveNamedEntityState.mockReturnValue(mutation.promise);
    const renderer = render();
    act(() => renderer.root.findAllByType('field')[0]!.props.onChangeText('旧scopeの変更'));
    let saving!: Promise<void>;
    await act(async () => { saving = action(renderer, '状態を保存').props.onPress(); });
    if (change === 'session') test.sessionKey = 'new-session';
    if (change === 'organization') test.organizationId = 'new-org';
    const nextEntity = change === 'entity' ? { ...entity, id: 'new-entity' } : entity;
    act(() => renderer.update(<EntityStateEditor entity={nextEntity} parentDirty={false} parentBusy={false} availableCredits={10} />));
    await act(async () => { mutation.resolve({ ...state, name: '旧scopeの変更' }); await saving; });
    expect(renderer.root.findAllByType('field')[0]!.props.value).toBe('');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('状態を保存しました');
    expect(test.queryClient.setQueryData).not.toHaveBeenCalled();
  });
  it('unmount後の確定receiptでcacheやUIを変更しない', async () => {
    test.jobs = [completedPreview]; const mutation = deferred<typeof confirmationReceipt>();
    test.api.confirmEntityStateReference.mockReturnValue(mutation.promise);
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    act(() => renderer.unmount());
    await act(async () => { mutation.resolve(confirmationReceipt); });
    expect(test.queryClient.setQueryData).not.toHaveBeenCalled();
    expect(test.queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('結果不明の確定は明示照合だけで同じjob候補のtokenを更新して元のrevisionを再送する', async () => {
    test.jobs = [completedPreview];
    test.api.confirmEntityStateReference.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(confirmationReceipt);
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    test.api.getJob.mockResolvedValue({ ...completedPreview, result: { provider_result: true, candidates: [{ candidate_token: 'renewed-same-candidate-token' }] } });
    await act(async () => { await renderer.root.findAllByType('notice').find((node) => node.props.onAction)!.props.onAction(); });
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledOnce();
    await act(async () => { action(renderer, '同じ候補の確定結果を照合').props.onPress(); action(renderer, '同じ候補の確定結果を照合').props.onPress(); });
    expect(test.api.getJob).toHaveBeenCalledWith('job', null);
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledTimes(2);
    expect(test.api.confirmEntityStateReference).toHaveBeenLastCalledWith('entity', 'state', { candidate_token: 'renewed-same-candidate-token', expected_state_revision: state.updated_at }, null);
    expect(test.api.generateEntityStateReference).not.toHaveBeenCalled();
    expect(test.api.createGenerationQuote).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('状態画像を確定しました');
  });
  it.each(['job', 'candidate', 'revision'] as const)('照合用の%sが元の候補と一致しなければ再確定しない', async (changed) => {
    test.jobs = [completedPreview]; test.api.confirmEntityStateReference.mockRejectedValue(new Error('offline'));
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    test.api.getJob.mockResolvedValue({ ...completedPreview,
      ...(changed === 'job' ? { id: 'other-job' } : {}),
      ...(changed === 'candidate' ? { result: { provider_result: true, candidates: [] } } : {}),
      ...(changed === 'revision' ? { params: { ...completedPreview.params, state_revision: '2026-01-02T00:00:00Z' } } : {}) });
    await act(async () => { action(renderer, '同じ候補の確定結果を照合').props.onPress(); });
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer.toJSON())).toContain('状態画像の確定結果を確認できません');
  });

  it('保存して移動の成功後は選択を進め、保存後の読込失敗を保存失敗にしない', async () => {
    const second = { ...state, id: 'second-state', name: '休息', description: '包帯を交換' };
    test.states = [state, second];
    test.api.saveNamedEntityState.mockResolvedValue({ ...state, name: '治療後' });
    test.queryClient.invalidateQueries.mockRejectedValue(new Error('offline'));
    const renderer = render();
    act(() => renderer.root.findAllByType('field')[0]!.props.onChangeText('治療後'));
    test.resolveDirtyEditors.mockImplementation(async () => { await (test.dirtyRegistration as { save: () => Promise<void> }).save(); return true; });
    await act(async () => { renderer.root.findByType('picker').props.onSelect('second-state'); });
    expect(renderer.root.findAllByType('field')[0]!.props.value).toBe('休息');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('最新表示の読み込みに失敗しました');
    expect(test.api.saveNamedEntityState).toHaveBeenCalledOnce();
  });
  it('以前の編集分岐から残った保存callbackでは新しい入力を保存しない', async () => {
    const renderer = render();
    act(() => renderer.root.findAllByType('field')[0]!.props.onChangeText('最初の入力'));
    const oldSave = action(renderer, '状態を保存').props.onPress;
    act(() => renderer.root.findAllByType('field')[0]!.props.onChangeText('新しい入力'));
    await act(async () => { await oldSave(); });
    expect(test.api.saveNamedEntityState).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('field')[0]!.props.value).toBe('新しい入力');
  });
  it('照合tokenの読込中に入力が変わると確定要求を再送しない', async () => {
    test.jobs = [completedPreview]; test.api.confirmEntityStateReference.mockRejectedValue(new Error('offline'));
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    const jobRead = deferred<typeof completedPreview>(); test.api.getJob.mockReturnValue(jobRead.promise);
    await act(async () => { action(renderer, '同じ候補の確定結果を照合').props.onPress(); });
    act(() => renderer.root.findAllByType('field')[0]!.props.onChangeText('編集中'));
    await act(async () => { jobRead.resolve(completedPreview); });
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByType('field')[0]!.props.value).toBe('編集中');
    expect(JSON.stringify(renderer.toJSON())).toContain('状態画像の確定結果を確認できません');
  });
  it('別stateの確定receiptを受け取っても現在の画像を変更しない', async () => {
    test.jobs = [completedPreview]; test.api.confirmEntityStateReference.mockResolvedValue({ ...confirmationReceipt, state_id: 'other-state' });
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    expect(test.queryClient.setQueryData).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('状態画像の確定結果を確認できません');
  });
  it('確定receiptが遅れてもその間に取得した新しいstate revisionを上書きしない', async () => {
    test.jobs = [completedPreview]; const mutation = deferred<typeof confirmationReceipt>();
    test.api.confirmEntityStateReference.mockReturnValue(mutation.promise);
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    const newer = { ...state, updated_at: '2026-01-03T00:00:00Z', reference_status: 'confirmed', reference_image: { ...confirmationReceipt.reference_image, ref_id: 'newer-image' } };
    test.states = [newer];
    await act(async () => { mutation.resolve(confirmationReceipt); });
    expect(test.states[0]).toEqual(newer);
    expect(JSON.stringify(renderer.toJSON())).toContain('newer-image');
  });

  it('照合後のCONFLICTと変更済み状態の読込後は未確認表示を残して明示的に編集へ戻れる', async () => {
    test.session = { capabilities: { entity_state_reference_generation: true, generation_quotes: true } };
    test.jobs = [completedPreview];
    test.api.confirmEntityStateReference.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new ApiError('stale after fencing', 409, 'CONFLICT'));
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    await act(async () => { action(renderer, '同じ候補の確定結果を照合').props.onPress(); });
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledTimes(2);
    test.states = [{ ...state, name: '新しい保存状態', description: '傷は治った', updated_at: '2026-01-03T00:00:00Z' }];
    await act(async () => { await renderer.root.findAllByType('notice').find((node) => node.props.onAction)!.props.onAction(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('状態画像の確定結果を確認できません');
    await act(async () => { action(renderer, '確定結果を未確認のまま編集に戻る').props.onPress(); });
    expect(renderer.root.findAllByType('field')[0]!.props.value).toBe('外傷');
    expect(JSON.stringify(renderer.toJSON())).toContain('前の状態画像の確定結果は未確認のままです');
    act(() => renderer.root.findAllByType('field')[0]!.props.onChangeText('別の編集'));
    test.api.saveNamedEntityState.mockResolvedValue({ ...state, name: '別の編集', updated_at: '2026-01-04T00:00:00Z' });
    await act(async () => { await action(renderer, '状態を保存').props.onPress(); });
    expect(action(renderer, 'プレビュー料金を確認').props.disabled).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain('前の状態画像の確定結果は未確認のままです');
    expect(test.api.createGenerationQuote).not.toHaveBeenCalled();
    expect(test.api.generateEntityStateReference).not.toHaveBeenCalled();
  });
  it('一般的なCONFLICTと同じ状態の再読込だけでは確定済みや精算済みと扱わない', async () => {
    test.jobs = [completedPreview]; test.api.confirmEntityStateReference.mockRejectedValue(new ApiError('conflict', 409, 'CONFLICT'));
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    await act(async () => { await renderer.root.findAllByType('notice').find((node) => node.props.onAction)!.props.onAction(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('状態画像の確定結果を確認できません');
    expect(action(renderer, '確定結果を未確認のまま編集に戻る')).toBeUndefined();
    expect(action(renderer, '同じ候補の確定結果を照合').props.disabled).toBe(false);
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledOnce();
  });

  it('結果不明の状態を再選択しても保持中の確定要求を消さず別状態から戻って照合できる', async () => {
    test.session = { capabilities: { entity_state_reference_generation: true, generation_quotes: true } };
    test.jobs = [completedPreview]; test.states = [state, { ...state, id: 'second', name: '休息' }];
    test.api.confirmEntityStateReference.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(confirmationReceipt);
    const renderer = render();
    act(() => renderer.root.findAllByType('button')[0]!.props.onPress());
    await act(async () => { action(renderer, '選択した候補を状態画像に確定').props.onPress(); });
    await act(async () => { renderer.root.findByType('picker').props.onSelect('state'); });
    expect(JSON.stringify(renderer.toJSON())).toContain('状態画像の確定結果を確認できません');
    expect(action(renderer, 'プレビュー料金を確認').props.disabled).toBe(true);
    await act(async () => { renderer.root.findByType('picker').props.onSelect('second'); });
    expect(renderer.root.findAllByType('field')[0]!.props.value).toBe('休息');
    await act(async () => { renderer.root.findByType('picker').props.onSelect('state'); });
    expect(JSON.stringify(renderer.toJSON())).toContain('状態画像の確定結果を確認できません');
    expect(action(renderer, 'プレビュー料金を確認').props.disabled).toBe(true);
    await act(async () => { action(renderer, '同じ候補の確定結果を照合').props.onPress(); });
    expect(test.api.confirmEntityStateReference).toHaveBeenCalledTimes(2);
  });
  it('終端jobの再読込失敗をcallback外へthrowせず読込専用の案内にする', async () => {
    const renderer = render(); test.queryClient.invalidateQueries.mockRejectedValue(new Error('offline'));
    await act(async () => { await expect(renderer.root.findByType('job-card').props.onCompleted()).resolves.toBeUndefined(); });
    expect(JSON.stringify(renderer.toJSON())).toContain('状態・参照画像・ジョブの読み込みに失敗しました');
    expect(test.api.confirmEntityStateReference).not.toHaveBeenCalled();
    expect(test.api.saveNamedEntityState).not.toHaveBeenCalled();
  });

});
