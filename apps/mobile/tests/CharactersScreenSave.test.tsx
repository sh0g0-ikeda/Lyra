import React from 'react';
import { act, create } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CharactersScreen } from '@/screens/CharactersScreen';
import { entityDetailQueryKey } from '@/lib/queryKeys';
import type { EntityRecord } from '@/domain/types';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { appStateMock, createExpoBinaryUploadFileMock, imagePickerMock, uploadAndImportEntityReferenceMock, workspaceContextMock } = vi.hoisted(() => ({
  appStateMock: vi.fn(),
  createExpoBinaryUploadFileMock: vi.fn(),
  imagePickerMock: vi.fn(),
  uploadAndImportEntityReferenceMock: vi.fn(),
  workspaceContextMock: vi.fn()
}));

vi.mock('react-native', () => ({
  Modal: ({ children }: React.PropsWithChildren) => React.createElement('modal', null, children),
  Pressable: ({ children, onPress, ...props }: React.PropsWithChildren<{ onPress?: () => void }>) =>
    React.createElement('button', { ...props, onClick: onPress }, children),
  ScrollView: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement('scroll-view', props, children),
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'text',
  View: 'view'
}));

vi.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
  launchImageLibraryAsync: imagePickerMock
}));
vi.mock('@/state/appState', () => ({ useAppState: appStateMock }));
vi.mock('@/state/dirtyState', () => ({
  useDirtyEditorRegistration: vi.fn(),
  useDirtyState: () => ({ resolveDirtyEditors: vi.fn().mockResolvedValue(true) })
}));
vi.mock('@/components/WorkspaceContextPicker', () => ({
  useWorkspaceContextSelection: workspaceContextMock
}));
vi.mock('@/hooks/useActiveResourceJobId', () => ({ useActiveResourceJobId: () => null }));
vi.mock('@/lib/confirm', () => ({
  confirmAction: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(),
  confirmDestructiveAction: vi.fn()
}));
vi.mock('@/lib/config', () => ({ config: { apiBaseUrl: 'http://test.invalid' } }));
vi.mock('@/lib/download', () => ({
  appendOrganizationQuery: (path: string) => path,
  saveAuthenticatedImageToPhotoLibrary: vi.fn()
}));
vi.mock('@/lib/expoBinaryUpload', () => ({ createExpoBinaryUploadFile: createExpoBinaryUploadFileMock }));
vi.mock('@/lib/directEntityReferenceUpload', () => ({
  DirectEntityUploadError: class DirectEntityUploadError extends Error {},
  uploadAndImportEntityReference: uploadAndImportEntityReferenceMock
}));

vi.mock('@/components/ActionableErrorNotice', () => ({ ActionableErrorNotice: () => null }));
vi.mock('@/components/CharacterOutfitField', () => ({ CharacterOutfitField: () => null }));
vi.mock('@/components/EntityGenerationBlockers', () => ({ EntityGenerationBlockers: () => null }));
vi.mock('@/components/EntityReferenceUploadStatus', () => ({ EntityReferenceUploadStatus: () => null }));
vi.mock('@/components/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }));
vi.mock('@/components/JobStatusCard', () => ({ JobStatusCard: () => null }));
vi.mock('@/components/Notice', () => ({ Notice: () => null }));
vi.mock('@/components/RecordPicker', () => ({ RecordPicker: () => null }));
vi.mock('@/components/ResilientImage', () => ({ ResilientImage: () => null }));
vi.mock('@/components/Screen', () => ({
  Screen: ({ children }: React.PropsWithChildren) => React.createElement('screen', null, children)
}));
vi.mock('@/components/Section', () => ({
  Section: ({ children }: React.PropsWithChildren) => React.createElement('section', null, children)
}));
vi.mock('@/components/SegmentedControl', () => ({ SegmentedControl: () => null }));
vi.mock('@/components/WorkspaceHierarchyNavigator', () => ({ WorkspaceHierarchyNavigator: () => null }));
vi.mock('@/components/PrimaryButton', () => ({
  PrimaryButton: ({ disabled, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) =>
    React.createElement('button', { disabled, onClick: onPress, testID: `button-${label}` }, label)
}));
vi.mock('@/components/FormField', () => ({
  FormField: ({ label, onChangeText, value }: { label: string; onChangeText: (value: string) => void; value: string }) =>
    React.createElement('input', { accessibilityLabel: label, onChange: onChangeText, value })
}));

const entity = (overrides: Partial<EntityRecord> = {}): EntityRecord => ({
  id: 'entity-detail-only',
  work_id: 'work-1',
  entity_type: 'character',
  name: '保存前',
  free_description: '最初の説明',
  structured_fields: {},
  prompt_supplement: null,
  speech_profile: {},
  status: 'draft',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...overrides
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('CharactersScreen の保存同期', () => {
  const api = {
    createEntity: vi.fn(),
    createEntityState: vi.fn(),
    createEntityReferenceUpload: vi.fn(),
    deleteEntity: vi.fn(),
    deleteEntityReference: vi.fn(),
    deleteEntityState: vi.fn(),
    generateEntityReference: vi.fn(),
    getEntitiesPage: vi.fn(),
    getEntity: vi.fn(),
    getEntityReferenceGenerationAvailability: vi.fn(),
    getEntityReferenceSet: vi.fn(),
    getEntityStates: vi.fn(),
    getJob: vi.fn(),
    getScenes: vi.fn(),
    importEntityImage: vi.fn(),
    updateEntity: vi.fn(),
    updateEntityState: vi.fn(),
    confirmEntityReference: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.getEntitiesPage.mockResolvedValue({ entities: [entity({ id: 'another-entity' })], next_cursor: null });
    api.getEntity.mockResolvedValue(entity());
    api.getEntityReferenceGenerationAvailability.mockResolvedValue({ enabled: true });
    api.getEntityReferenceSet.mockResolvedValue({
      entity_id: 'entity-detail-only', primary_ref_id: null, status: 'empty', updated_at: '2026-09-01T00:00:00.000Z', reference_images: []
    });
    api.getEntityStates.mockResolvedValue({ entity_states: [] });
    api.getScenes.mockResolvedValue({ scenes: [] });
    createExpoBinaryUploadFileMock.mockReturnValue({
      exists: true,
      sizeBytes: 1024,
      source: { uri: 'file:///character.jpg' }
    });
    imagePickerMock.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///character.jpg', mimeType: 'image/jpeg', base64: '/9j/' }]
    });
    uploadAndImportEntityReferenceMock.mockResolvedValue({
      prompt_supplement: '画像からの補足',
      suggested_fields: { hair_color: 'black' },
      tmp_image_token: 'candidate-1'
    });
    appStateMock.mockReturnValue({
      api,
      hasCapability: () => true,
      language: 'en',
      logout: vi.fn(),
      refreshIdToken: vi.fn(),
      selection: { entityId: 'entity-detail-only', organizationId: null },
      session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1',
      tokens: null,
      trackJob: vi.fn(),
      updateSelection: vi.fn().mockResolvedValue(true)
    });
    workspaceContextMock.mockReturnValue({ selectedWorkId: 'work-1', selectedEpisodeId: null });
  });

  const renderScreen = async (initial: EntityRecord): Promise<{ renderer: ReturnType<typeof create>; queryClient: QueryClient }> => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    queryClient.setQueryData(entityDetailQueryKey('session-1', initial.id, null), initial);
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<QueryClientProvider client={queryClient}><CharactersScreen /></QueryClientProvider>);
      for (let index = 0; index < 4; index += 1) await flush();
    });
    return { renderer: renderer!, queryClient };
  };

  const button = (renderer: ReturnType<typeof create>, label: string) =>
    renderer.root.findByProps({ testID: `button-${label}` });

  it('詳細だけで選択されたキャラクターを保存した後、次の保存に返却revisionを使う', async () => {
    const initial = entity();
    const saved = entity({ name: '保存済み', updated_at: '2026-09-02T00:00:00.000Z' });
    api.updateEntity.mockResolvedValue(saved);
    const { renderer, queryClient } = await renderScreen(initial);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange('保存済み');
      await flush();
    });
    await act(async () => {
      button(renderer, 'Save').props.onClick();
      await flush();
    });

    expect(api.updateEntity).toHaveBeenCalledWith(initial.id, expect.objectContaining({ expected_updated_at: initial.updated_at }), null);
    expect(queryClient.getQueryData(entityDetailQueryKey('session-1', initial.id, null))).toMatchObject({
      name: '保存済み', updated_at: saved.updated_at
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange('再編集');
      await flush();
    });
    await act(async () => {
      button(renderer, 'Save').props.onClick();
      await flush();
    });
    expect(api.updateEntity).toHaveBeenLastCalledWith(initial.id, expect.objectContaining({ expected_updated_at: saved.updated_at }), null);
  });

  it('生成前の保存が成功して生成が422でも、次の保存に返却revisionを使う', async () => {
    const initial = entity();
    const saved = entity({ free_description: '生成前に保存した説明', updated_at: '2026-09-02T00:00:00.000Z' });
    api.updateEntity.mockResolvedValue(saved);
    api.generateEntityReference.mockRejectedValue(new Error('422 VALIDATION_ERROR'));
    const { renderer, queryClient } = await renderScreen(initial);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Additional details' }).props.onChange('生成前に保存した説明');
      await flush();
    });
    await act(async () => {
      button(renderer, 'Create preview image').props.onClick();
      await flush();
    });

    expect(api.generateEntityReference).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(entityDetailQueryKey('session-1', initial.id, null))).toMatchObject({
      free_description: saved.free_description, updated_at: saved.updated_at
    });

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Additional details' }).props.onChange('再編集後の説明');
      await flush();
    });
    await act(async () => {
      button(renderer, 'Save').props.onClick();
      await flush();
    });
    expect(api.updateEntity).toHaveBeenLastCalledWith(initial.id, expect.objectContaining({ expected_updated_at: saved.updated_at }), null);
  });

  it('同じキャラクターの保存応答で、取り込み済み候補を消さない', async () => {
    const initial = entity();
    const saved = entity({ updated_at: '2026-09-02T00:00:00.000Z' });
    api.updateEntity.mockResolvedValue(saved);
    const { renderer } = await renderScreen(initial);

    await act(async () => {
      button(renderer, 'Import image').props.onClick();
      for (let index = 0; index < 5; index += 1) await flush();
    });
    expect(uploadAndImportEntityReferenceMock).toHaveBeenCalledTimes(1);
    expect(button(renderer, 'Confirm').props.disabled).toBe(false);

    await act(async () => {
      button(renderer, 'Save').props.onClick();
      await flush();
    });
    expect(button(renderer, 'Confirm').props.disabled).toBe(false);
  });

  it('保存中に入力した文字は返却entityで上書きしない', async () => {
    const initial = entity();
    const saved = entity({ name: 'サーバーが整形した名前', updated_at: '2026-09-02T00:00:00.000Z' });
    let resolveUpdate: ((value: EntityRecord) => void) | undefined;
    api.updateEntity.mockImplementation(() => new Promise<EntityRecord>((resolve) => { resolveUpdate = resolve; }));
    const { renderer, queryClient } = await renderScreen(initial);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange('送信時の名前');
      await flush();
    });
    await act(async () => {
      button(renderer, 'Save').props.onClick();
      await flush();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange('保存中に追記した名前');
      await flush();
    });
    await act(async () => {
      resolveUpdate?.(saved);
      await flush();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.value).toBe('保存中に追記した名前');
    expect(button(renderer, 'Save').props.disabled).toBe(false);
    expect(queryClient.getQueryData(entityDetailQueryKey('session-1', initial.id, null))).toMatchObject({ updated_at: saved.updated_at });
  });

  it('保存後に新しい入力がなければ、サーバーで整形された値を表示する', async () => {
    const initial = entity();
    const saved = entity({ name: 'サーバーが整形した名前', updated_at: '2026-09-02T00:00:00.000Z' });
    api.updateEntity.mockResolvedValue(saved);
    const { renderer } = await renderScreen(initial);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange('送信した名前');
      await flush();
    });
    await act(async () => {
      button(renderer, 'Save').props.onClick();
      await flush();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.value).toBe(saved.name);
    expect(button(renderer, 'Save').props.disabled).toBe(true);
  });

  it('新規作成の返却entityを正確な詳細cacheへ保存する', async () => {
    const created = entity({ id: 'created-entity', name: '新規キャラクター', updated_at: '2026-09-02T00:00:00.000Z' });
    api.createEntity.mockResolvedValue(created);
    appStateMock.mockReturnValue({
      api,
      hasCapability: () => true,
      language: 'en',
      logout: vi.fn(),
      refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null },
      session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1',
      tokens: null,
      trackJob: vi.fn(),
      updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer, queryClient } = await renderScreen(created);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(created.name);
      await flush();
    });
    await act(async () => {
      button(renderer, 'Create').props.onClick();
      await flush();
    });

    expect(api.createEntity).toHaveBeenCalledWith('work-1', expect.objectContaining({ name: created.name }), null);
    expect(queryClient.getQueryData(entityDetailQueryKey('session-1', created.id, null))).toMatchObject({
      id: created.id, updated_at: created.updated_at
    });
  });

  it('名前未入力の新規キャラクターでは画像取り込みを開始できない', async () => {
    appStateMock.mockReturnValue({
      api,
      hasCapability: () => true,
      language: 'en',
      logout: vi.fn(),
      refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null },
      session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1',
      tokens: null,
      trackJob: vi.fn(),
      updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer } = await renderScreen(entity());

    expect(button(renderer, 'Import image').props.disabled).toBe(true);
  });

  it('名前付き新規キャラクターはPOST成功後に返却IDでpickerを開く', async () => {
    const created = entity({ id: 'created-for-import', name: '取り込み用新規', updated_at: '2026-09-02T00:00:00.000Z' });
    let resolveCreate: ((value: EntityRecord) => void) | undefined;
    api.createEntity.mockImplementation(() => new Promise<EntityRecord>((resolve) => { resolveCreate = resolve; }));
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer } = await renderScreen(created);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(created.name);
      await flush();
    });
    await act(async () => {
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    expect(api.createEntity).toHaveBeenCalledTimes(1);
    expect(imagePickerMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate?.(created);
      for (let index = 0; index < 5; index += 1) await flush();
    });
    expect(imagePickerMock).toHaveBeenCalledTimes(1);
    expect(uploadAndImportEntityReferenceMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: created.id }));
  });

  it('pickerをcancelしても作成済み新規キャラクターを再POSTしない', async () => {
    const created = entity({ id: 'created-after-cancel', name: 'cancel後の新規' });
    api.createEntity.mockResolvedValue(created);
    imagePickerMock.mockResolvedValue({ canceled: true, assets: [] });
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer } = await renderScreen(created);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(created.name);
      await flush();
      button(renderer, 'Import image').props.onClick();
      for (let index = 0; index < 5; index += 1) await flush();
    });
    await act(async () => {
      button(renderer, 'Import image').props.onClick();
      for (let index = 0; index < 5; index += 1) await flush();
    });
    expect(api.createEntity).toHaveBeenCalledTimes(1);
    expect(imagePickerMock).toHaveBeenCalledTimes(2);
  });

  it('新規POST失敗時はpickerを開かず、再タップで一度だけ再試行できる', async () => {
    const draft = entity({ name: '失敗後も残す新規' });
    api.createEntity.mockRejectedValue(new Error('network failure'));
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer } = await renderScreen(draft);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(draft.name);
      await flush();
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    expect(api.createEntity).toHaveBeenCalledTimes(1);
    expect(imagePickerMock).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.value).toBe(draft.name);

    await act(async () => {
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    expect(api.createEntity).toHaveBeenCalledTimes(2);
    expect(imagePickerMock).not.toHaveBeenCalled();
  });

  it('dirty既存キャラクターはPUT成功後にだけpickerを開き、cleanならPUTしない', async () => {
    const initial = entity();
    const saved = entity({ name: '更新して取り込む', updated_at: '2026-09-02T00:00:00.000Z' });
    let resolveUpdate: ((value: EntityRecord) => void) | undefined;
    api.updateEntity.mockImplementation(() => new Promise<EntityRecord>((resolve) => { resolveUpdate = resolve; }));
    const { renderer } = await renderScreen(initial);

    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(saved.name);
      await flush();
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    expect(api.updateEntity).toHaveBeenCalledTimes(1);
    expect(imagePickerMock).not.toHaveBeenCalled();
    await act(async () => {
      resolveUpdate?.(saved);
      for (let index = 0; index < 5; index += 1) await flush();
    });
    expect(imagePickerMock).toHaveBeenCalledTimes(1);
    expect(uploadAndImportEntityReferenceMock).toHaveBeenCalledWith(expect.objectContaining({ entityId: saved.id }));
  });

  it('dirty既存キャラクターのPUT失敗ではpickerを開かず、同じ入力で再試行できる', async () => {
    const initial = entity();
    api.updateEntity.mockRejectedValue(new Error('network failure'));
    const { renderer } = await renderScreen(initial);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange('PUT失敗後も残す');
      await flush();
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    expect(api.updateEntity).toHaveBeenCalledTimes(1);
    expect(imagePickerMock).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.value).toBe('PUT失敗後も残す');
    await act(async () => {
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    expect(api.updateEntity).toHaveBeenCalledTimes(2);
  });

  it('新規取り込みの連打はPOSTとpickerを各一回に制限する', async () => {
    const created = entity({ id: 'created-once', name: '連打対象' });
    let resolveCreate: ((value: EntityRecord) => void) | undefined;
    api.createEntity.mockImplementation(() => new Promise<EntityRecord>((resolve) => { resolveCreate = resolve; }));
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer } = await renderScreen(created);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(created.name);
      await flush();
      button(renderer, 'Import image').props.onClick();
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    expect(api.createEntity).toHaveBeenCalledTimes(1);
    expect(imagePickerMock).not.toHaveBeenCalled();
    await act(async () => {
      resolveCreate?.(created);
      for (let index = 0; index < 5; index += 1) await flush();
    });
    expect(imagePickerMock).toHaveBeenCalledTimes(1);
  });

  it('CreateとImportを同時に押しても一つのPOST以外を開始しない', async () => {
    const created = entity({ id: 'created-shared-lock', name: '共有ロック' });
    let resolveCreate: ((value: EntityRecord) => void) | undefined;
    api.createEntity.mockImplementation(() => new Promise<EntityRecord>((resolve) => { resolveCreate = resolve; }));
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer } = await renderScreen(created);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(created.name);
      await flush();
      button(renderer, 'Create').props.onClick();
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    expect(api.createEntity).toHaveBeenCalledTimes(1);
    expect(imagePickerMock).not.toHaveBeenCalled();
    await act(async () => {
      resolveCreate?.(created);
      for (let index = 0; index < 5; index += 1) await flush();
    });
    expect(imagePickerMock).not.toHaveBeenCalled();
  });

  it('日本語でも名前未入力の新規キャラクターは画像取り込みできない', async () => {
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'ja', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer } = await renderScreen(entity());
    expect(button(renderer, '画像取り込み').props.disabled).toBe(true);
    expect(api.createEntity).not.toHaveBeenCalled();
    expect(imagePickerMock).not.toHaveBeenCalled();
  });

  it('新規POST中の追加入力はcreated selectionのrender後も保持してdirtyのままにする', async () => {
    const created = entity({ id: 'created-typing', name: '送信時の名前', updated_at: '2026-09-02T00:00:00.000Z' });
    let resolveCreate: ((value: EntityRecord) => void) | undefined;
    api.createEntity.mockImplementation(() => new Promise<EntityRecord>((resolve) => { resolveCreate = resolve; }));
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer, queryClient } = await renderScreen(created);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(created.name);
      await flush();
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange('POST後に追記した名前');
      await flush();
    });
    await act(async () => {
      resolveCreate?.(created);
      for (let index = 0; index < 5; index += 1) await flush();
    });
    queryClient.setQueryData(entityDetailQueryKey('session-1', created.id, null), created);
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: created.id, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    await act(async () => {
      renderer.update(<QueryClientProvider client={queryClient}><CharactersScreen /></QueryClientProvider>);
      await flush();
    });
    expect(renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.value).toBe('POST後に追記した名前');
    expect(button(renderer, 'Save').props.disabled).toBe(false);
  });

  it('新規取り込みcandidateはcreated selectionのcommit後もConfirm可能なまま残る', async () => {
    const created = entity({ id: 'created-candidate', name: '候補を保持する新規' });
    api.createEntity.mockResolvedValue(created);
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    const { renderer, queryClient } = await renderScreen(created);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(created.name);
      await flush();
      button(renderer, 'Import image').props.onClick();
      for (let index = 0; index < 6; index += 1) await flush();
    });
    queryClient.setQueryData(entityDetailQueryKey('session-1', created.id, null), created);
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: created.id, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    await act(async () => {
      renderer.update(<QueryClientProvider client={queryClient}><CharactersScreen /></QueryClientProvider>);
      await flush();
    });
    expect(renderer.root.findAllByType('text').some((node) => node.children.includes('Imported candidate'))).toBe(true);
    expect(button(renderer, 'Confirm').props.disabled).toBe(false);
  });

  it('新規POST待機中に別scopeへ移ると元scopeだけをcacheしpickerもselection更新もしない', async () => {
    const created = entity({ id: 'created-original-scope', name: '元scope', updated_at: '2026-09-02T00:00:00.000Z' });
    const switched = entity({ id: 'other-scope-entity', work_id: 'work-2', name: '切替先' });
    let resolveCreate: ((value: EntityRecord) => void) | undefined;
    const updateSelection = vi.fn().mockResolvedValue(true);
    api.createEntity.mockImplementation(() => new Promise<EntityRecord>((resolve) => { resolveCreate = resolve; }));
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: null, organizationId: null }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection
    });
    const { renderer, queryClient } = await renderScreen(created);
    await act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Name' }).props.onChange(created.name);
      await flush();
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    queryClient.setQueryData(entityDetailQueryKey('session-1', switched.id, 'org-2'), switched);
    workspaceContextMock.mockReturnValue({ selectedWorkId: 'work-2', selectedEpisodeId: null });
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: switched.id, organizationId: 'org-2' }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection
    });
    await act(async () => {
      renderer.update(<QueryClientProvider client={queryClient}><CharactersScreen /></QueryClientProvider>);
      await flush();
    });
    await act(async () => {
      resolveCreate?.(created);
      for (let index = 0; index < 4; index += 1) await flush();
    });
    expect(queryClient.getQueryData(entityDetailQueryKey('session-1', created.id, null))).toMatchObject({ updated_at: created.updated_at });
    expect(imagePickerMock).not.toHaveBeenCalled();
    expect(updateSelection).not.toHaveBeenCalled();
  });

  it('picker待機中のscope変更ではuploadを開始しない', async () => {
    const initial = entity();
    const switched = entity({ id: 'picker-scope-switched', work_id: 'work-2' });
    let resolvePicker: ((value: { canceled: boolean; assets: { uri: string; mimeType: string; base64: string }[] }) => void) | undefined;
    imagePickerMock.mockImplementation(() => new Promise((resolve) => { resolvePicker = resolve; }));
    const { renderer, queryClient } = await renderScreen(initial);
    await act(async () => {
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    expect(imagePickerMock).toHaveBeenCalledTimes(1);
    queryClient.setQueryData(entityDetailQueryKey('session-1', switched.id, 'org-2'), switched);
    workspaceContextMock.mockReturnValue({ selectedWorkId: 'work-2', selectedEpisodeId: null });
    appStateMock.mockReturnValue({
      api, hasCapability: () => true, language: 'en', logout: vi.fn(), refreshIdToken: vi.fn(),
      selection: { entityId: switched.id, organizationId: 'org-2' }, session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1', tokens: null, trackJob: vi.fn(), updateSelection: vi.fn().mockResolvedValue(true)
    });
    await act(async () => {
      renderer.update(<QueryClientProvider client={queryClient}><CharactersScreen /></QueryClientProvider>);
      await flush();
    });
    await act(async () => {
      resolvePicker?.({ canceled: false, assets: [{ uri: 'file:///character.jpg', mimeType: 'image/jpeg', base64: '/9j/' }] });
      for (let index = 0; index < 4; index += 1) await flush();
    });
    expect(uploadAndImportEntityReferenceMock).not.toHaveBeenCalled();
  });

  it('選択変更後に完了した取り込み結果を、新しいキャラクターの候補にしない', async () => {
    const initial = entity();
    const switched = entity({ id: 'entity-after-switch', name: '選択先' });
    let resolveImport: ((value: { prompt_supplement: string; suggested_fields: Record<string, unknown>; tmp_image_token: string }) => void) | undefined;
    uploadAndImportEntityReferenceMock.mockImplementation(
      () => new Promise((resolve) => { resolveImport = resolve; })
    );
    const { renderer, queryClient } = await renderScreen(initial);

    await act(async () => {
      button(renderer, 'Import image').props.onClick();
      await flush();
    });
    queryClient.setQueryData(entityDetailQueryKey('session-1', switched.id, null), switched);
    appStateMock.mockReturnValue({
      api,
      hasCapability: () => true,
      language: 'en',
      logout: vi.fn(),
      refreshIdToken: vi.fn(),
      selection: { entityId: switched.id, organizationId: null },
      session: { organizations: [], personal_credits: { total_credits: 10 } },
      sessionKey: 'session-1',
      tokens: null,
      trackJob: vi.fn(),
      updateSelection: vi.fn().mockResolvedValue(true)
    });
    await act(async () => {
      renderer.update(<QueryClientProvider client={queryClient}><CharactersScreen /></QueryClientProvider>);
      await flush();
    });
    await act(async () => {
      resolveImport?.({
        prompt_supplement: '遅延した補足',
        suggested_fields: { hair_color: 'black' },
        tmp_image_token: 'late-candidate'
      });
      await flush();
    });

    expect(renderer.root.findAllByType('text').some((node) => node.children.includes('Imported candidate'))).toBe(false);
    expect(button(renderer, 'Confirm').props.disabled).toBe(true);
  });

  it('取り込み候補を保存後の生成へ元のentity IDとtokenで渡す', async () => {
    const initial = entity();
    const saved = entity({
      structured_fields: { hair_color: 'black' },
      prompt_supplement: '画像からの補足',
      updated_at: '2026-09-02T00:00:00.000Z'
    });
    api.updateEntity.mockResolvedValue(saved);
    api.generateEntityReference.mockResolvedValue({ job_id: 'job-1' });
    const { renderer } = await renderScreen(initial);

    await act(async () => {
      button(renderer, 'Import image').props.onClick();
      for (let index = 0; index < 5; index += 1) await flush();
    });
    await act(async () => {
      button(renderer, 'Save').props.onClick();
      await flush();
    });
    await act(async () => {
      button(renderer, 'Create preview image').props.onClick();
      await flush();
    });

    expect(api.generateEntityReference).toHaveBeenCalledWith(initial.id, {
      source_candidate_token: 'candidate-1'
    }, null);
  });
});
