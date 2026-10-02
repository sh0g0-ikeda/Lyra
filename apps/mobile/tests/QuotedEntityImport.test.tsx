import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuotedEntityImport } from '@/components/QuotedEntityImport';
const mocks = vi.hoisted(() => ({
  api: { createEntityReferenceUpload: vi.fn(), createGenerationQuote: vi.fn(), acceptGenerationQuote: vi.fn(), getGenerationQuote: vi.fn(), importEntityImage: vi.fn() },
  session: { capabilities: { generation_quotes: true } }, pick: vi.fn(), confirm: vi.fn(), upload: vi.fn(), cancel: vi.fn(), release: vi.fn(), trackJob: vi.fn(), apply: vi.fn(), busy: vi.fn(), job: null as Record<string, unknown> | null
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native', () => ({ Text: 'text', View: 'view' }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000003' }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mocks.pick }));
vi.mock('@/lib/expoBinaryUpload', () => ({ createExpoBinaryUploadFile: () => ({ exists: true, sizeBytes: 42, source: { createUploadTask: () => ({ uploadAsync: mocks.upload, cancel: mocks.cancel, release: mocks.release }) } }) }));
vi.mock('@/state/appState', () => ({ useAppState: () => ({ api: mocks.api, session: mocks.session, sessionKey: 'session', selection: { organizationId: null }, language: 'en', hasCapability: () => true, trackJob: mocks.trackJob }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: async () => undefined }), useQuery: () => ({ data: mocks.job ?? undefined, error: null, refetch: vi.fn() }) }));
vi.mock('@/lib/confirm', () => ({ confirmAction: mocks.confirm }));
vi.mock('@/components/PrimaryButton', () => ({ PrimaryButton: 'action' }));
vi.mock('@/components/AssetGenerationQuoteDialog', () => ({ AssetGenerationQuoteDialog: 'quote' }));
vi.mock('@/components/EntityReferenceUploadStatus', () => ({ EntityReferenceUploadStatus: 'upload' }));
vi.mock('@/components/JobStatusCard', () => ({ JobStatusCard: 'job' }));
vi.mock('@/components/Notice', () => ({ Notice: 'notice' }));
const quote = { quote_id: 'quote', quote_token: 'opaque', operation: 'entity_import_analysis', target_id: 'uploaded-source', billing_scope: { kind: 'personal', organization_id: null }, image_model: null, quality: null, render_style: null, reference_count: 1, amount_credits: 4, expires_at: '2099-01-01T00:00:00Z', blockers: [] };
const receipt = { quote_id: 'quote', job_id: 'analysis-job', accepted_at: '2026-10-01T00:00:00Z', amount_credits: 4 };
const result = { suggested_fields: { hair_color: 'black' }, prompt_supplement: 'analyzed', tmp_image_token: 'candidate' };
let renderer: ReactTestRenderer;
const props = { entityId: 'entity', entityType: 'character' as const, entityName: 'Akira', workId: 'work', draftRevision: 'draft-1', onApply: mocks.apply, onBusyChange: mocks.busy };
async function render(changes = {}): Promise<void> { await act(async () => { renderer = create(<QuotedEntityImport {...props} {...changes} />); }); }
async function press(id: string): Promise<void> { await act(async () => { renderer.root.findByProps({ testID: id }).props.onPress(); }); }
async function confirm(): Promise<void> { await act(async () => { mocks.confirm.mock.calls.at(-1)?.[0].onConfirm(); }); }
async function upload(): Promise<void> { await press('quoted-import-upload'); await confirm(); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.job = null; mocks.session.capabilities.generation_quotes = true;
  mocks.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///image.png', mimeType: 'image/png' }] });
  mocks.api.createEntityReferenceUpload.mockResolvedValue({ upload_url: 'https://upload.example/file', upload_token: 'uploaded', expires_at: '2099-01-01T00:00:00Z', upload_headers: { 'Content-Type': 'image/png', 'x-amz-server-side-encryption': 'AES256' } });
  mocks.upload.mockResolvedValue({ status: 200, body: '', headers: {} });
  mocks.api.createGenerationQuote.mockResolvedValue(quote); mocks.api.acceptGenerationQuote.mockResolvedValue(receipt);
  mocks.api.getGenerationQuote.mockResolvedValue({ ...receipt, job_id: null, accepted_at: null }); mocks.trackJob.mockResolvedValue(undefined);
});
describe('quoted import analysis', () => {
  it('gates the paid workflow and preserves the legacy API without calling it', async () => {
    mocks.session.capabilities.generation_quotes = false; await render();
    expect(renderer.root.findByProps({ testID: 'quoted-import-upload' }).props.disabled).toBe(true);
    await press('quoted-import-upload'); await confirm();
    expect(mocks.pick).not.toHaveBeenCalled(); expect(mocks.api.importEntityImage).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
  it('uploads after permission, shows server price, and accepts only by a separate explicit action', async () => {
    await render(); await press('quoted-import-upload'); expect(mocks.pick).not.toHaveBeenCalled(); await confirm();
    expect(mocks.api.createGenerationQuote).toHaveBeenCalledWith({ operation: 'entity_import_analysis', upload_token: 'uploaded', entity_type: 'character', entity_id: 'entity' }, null);
    expect(renderer.root.findByType('quote').props.state.quote.amount_credits).toBe(4);
    expect(mocks.api.acceptGenerationQuote).not.toHaveBeenCalled(); expect(mocks.api.importEntityImage).not.toHaveBeenCalled();
    await act(async () => { renderer.root.findByType('quote').props.onAccept(); renderer.root.findByType('quote').props.onAccept(); });
    expect(mocks.api.acceptGenerationQuote).toHaveBeenCalledOnce(); expect(mocks.trackJob).toHaveBeenCalledWith('analysis-job');
    expect(mocks.apply).not.toHaveBeenCalled(); act(() => renderer.unmount());
  });
  it('never overwrites edits made during analysis and validates the draft again after apply confirmation', async () => {
    await render(); await upload(); await act(async () => { renderer.root.findByType('quote').props.onAccept(); });
    mocks.job = { id: 'analysis-job', job_type: 'entity_import_analysis', status: 'completed', params: { entity_id: 'entity', entity_type: 'character' }, result };
    await act(async () => { renderer.update(<QuotedEntityImport {...props} draftRevision="draft-2" />); });
    expect(mocks.apply).not.toHaveBeenCalled(); await press('quoted-import-apply');
    expect(mocks.confirm.mock.calls.at(-1)?.[0].message).toContain('draft changed');
    await act(async () => { renderer.update(<QuotedEntityImport {...props} draftRevision="draft-3" />); });
    await confirm(); expect(mocks.apply).not.toHaveBeenCalled();
    await press('quoted-import-apply'); await confirm(); expect(mocks.apply).toHaveBeenCalledWith(result, 'draft-3');
    act(() => renderer.unmount());
  });
  it('does not apply a different job or malformed completed result', async () => {
    await render(); await upload(); await act(async () => { renderer.root.findByType('quote').props.onAccept(); });
    mocks.job = { id: 'different-job', job_type: 'entity_import_analysis', status: 'completed', params: { entity_id: 'entity', entity_type: 'character' }, result };
    await act(async () => { renderer.update(<QuotedEntityImport {...props} />); });
    expect(renderer.root.findAllByProps({ testID: 'quoted-import-apply' })).toHaveLength(0);
    mocks.job = { ...mocks.job, id: 'analysis-job', result: { suggested_fields: {} } };
    await act(async () => { renderer.update(<QuotedEntityImport {...props} />); });
    expect(renderer.root.findAllByProps({ testID: 'quoted-import-apply' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('could not be loaded'); expect(mocks.apply).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
  it('keeps unknown acceptance and the same key when reopened, without restarting analysis', async () => {
    await render(); await upload(); mocks.api.acceptGenerationQuote.mockRejectedValueOnce(new Error('timeout'));
    await act(async () => { renderer.root.findByType('quote').props.onAccept(); });
    expect(renderer.root.findByType('quote').props.state.phase).toBe('unknown');
    act(() => renderer.root.findByType('quote').props.onClose());
    await press('quoted-import-review');
    expect(renderer.root.findByType('quote').props.state.visible).toBe(true);
    await act(async () => { renderer.root.findByType('quote').props.onAccept(); });
    expect(mocks.api.acceptGenerationQuote.mock.calls[0]).toEqual(mocks.api.acceptGenerationQuote.mock.calls[1]);
    expect(mocks.api.createGenerationQuote).toHaveBeenCalledOnce(); expect(mocks.api.importEntityImage).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
  it('does not quote a late image-picker result after the selected entity changes', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.pick.mockImplementation(() => new Promise((resolve) => { finish = resolve; })); await render(); await upload();
    await act(async () => { renderer.update(<QuotedEntityImport {...props} entityId="other-entity" />); });
    await act(async () => { finish({ canceled: false, assets: [{ uri: 'file:///image.png', mimeType: 'image/png' }] }); });
    expect(mocks.api.createGenerationQuote).not.toHaveBeenCalled(); expect(mocks.api.createEntityReferenceUpload).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
