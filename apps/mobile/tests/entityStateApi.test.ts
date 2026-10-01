import { afterEach, describe, expect, it, vi } from 'vitest';
import { LyraMobileApiClient } from '@/lib/api';
const state = { id: 'state', entity_id: 'entity', scene_id: null, name: '外傷', description: '左頬に傷', costume_note: 'keep', costume_ref_id: 'legacy', condition_note: null, hair_note: null, expression_default: 'neutral', extra_note: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
describe('named state API', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('状態名と自由入力だけを保存し既存ノートと基本参照を上書きしない', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(state), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock); const api = new LyraMobileApiClient(() => 'token');
    await api.saveNamedEntityState('entity', 'state', { name: '外傷', description: '左頬に傷' }, 'org');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/entities/entity/states/state?organization_id=org');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ name: '外傷', description: '左頬に傷' });
    expect(fetchMock.mock.calls[0]?.[1].method).toBe('PUT');
    await api.saveNamedEntityState('entity', null, { name: '外傷', description: '左頬に傷' }, 'org');
    expect(fetchMock.mock.calls[1]?.[1].method).toBe('POST');
  });
  it('previewは空body、確定はpublic候補tokenと固定revisionのみを送る', async () => {
    const descriptor = { ref_id: 'ref', image_model: 'gpt-image-2', base_ref_id: 'base', created_at: state.updated_at, input_fingerprint: 'a'.repeat(64) };
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ job_id: 'job', state_revision: state.updated_at }), { status: 202 })).mockResolvedValueOnce(new Response(JSON.stringify({ entity_id: 'entity', state_id: 'state', state_revision: state.updated_at, reference_image: descriptor }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock); const api = new LyraMobileApiClient(() => 'token');
    await api.generateEntityStateReference('entity', 'state', 'org');
    await api.confirmEntityStateReference('entity', 'state', { candidate_token: 'signed', expected_state_revision: state.updated_at }, 'org');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/entities/entity/states/state/generate-reference?organization_id=org');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({});
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({ candidate_token: 'signed', expected_state_revision: state.updated_at });
  });
  it('state自動入力は明示設定時だけv1と上書き方針を追加し従来bodyを維持する', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ job_id: 'job' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock); const api = new LyraMobileApiClient(() => 'token');
    await api.autofillEpisodePagesFromStory('episode', 'ja', 'org');
    await api.autofillEpisodePagesFromStory('episode', 'ja', 'org', { state_autofill_version: 'v1', state_assignment_policy: 'preserve_existing' });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ language: 'ja' });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({ language: 'ja', state_autofill_version: 'v1', state_assignment_policy: 'preserve_existing' });
  });
});
