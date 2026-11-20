import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('LyraMobileApiClient character suggestions', () => {
  it('uses the selected organization and strict current episode version for suggestions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      version: 7,
      characters: [{
        name: '澪',
        name_quote: '澪は窓辺に立った。',
        entity_type: 'character',
        status: 'new',
        entity_ids: [],
        appearance: [{ field: 'hair_color', value: '黒髪', quote: '黒髪が風になびく。' }],
        changes: [],
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.suggestEpisodeCharacters('episode-1', {
      version: 7,
      production_notes_enabled: true,
    }, 'organization-1')).resolves.toMatchObject({ version: 7 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/episodes/episode-1/character-suggestions?organization_id=organization-1'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ version: 7, production_notes_enabled: true }),
      }),
    );
  });

  it('reads the optional capability without changing existing legacy requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getCharacterSuggestionCapabilities()).resolves.toEqual({ enabled: true });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/story/character-suggestion-capabilities'),
      expect.any(Object),
    );
  });

  it('uses the current episode version and organization for persisted character autofill', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      version: 8,
      characters: [{
        entity_id: '00000000-0000-4000-8000-000000000001',
        name: '澪',
        created: true,
        states_added: 1,
      }],
      skipped_names: ['通行人'],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.autofillEpisodeCharacters('episode-1', { version: 8 }, 'organization-1'))
      .resolves.toMatchObject({ version: 8, skipped_names: ['通行人'] });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/episodes/episode-1/character-autofill?organization_id=organization-1&appearance_review=1'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 8 }) }),
    );
  });

  it('parses negotiated appearance review data and approves one field with its revision', async () => {
    const entityId = '00000000-0000-4000-8000-000000000001';
    const expectedUpdatedAt = '2026-11-20T00:00:00.000Z';
    const entityResponse = {
      id: entityId, work_id: '00000000-0000-4000-8000-000000000002', entity_type: 'character', name: '澪',
      free_description: null, prompt_supplement: null, structured_fields: { hair: { color: 'black' } }, speech_profile: {},
      status: 'draft', created_at: expectedUpdatedAt, updated_at: '2026-11-20T00:01:00.000Z',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        version: 8, characters: [], skipped_names: [], appearance_review: {
          unresolved: [{ quote: '暗い色の髪が見えた。', reason: 'unverified_trait' }],
          suggestions: [{ entity_id: entityId, name: '澪', field: 'hair.color', value: 'black', quote: '澪は黒髪だった。', expected_updated_at: expectedUpdatedAt }],
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entityResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    const result = await client.autofillEpisodeCharacters('episode-1', { version: 8 });
    const suggestion = result.appearance_review?.suggestions[0];
    expect(suggestion).toBeDefined();
    await expect(client.approveCharacterAppearance(suggestion!, 'organization-1')).resolves.toEqual(entityResponse);

    expect(fetchMock.mock.calls[1]?.[0]).toEqual(expect.stringContaining(`/api/entities/${entityId}/appearance-review?organization_id=organization-1`));
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      field: 'hair.color', value: 'black', expected_updated_at: expectedUpdatedAt,
    });
  });

  it('accepts the older autofill response shape after requesting appearance review', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 8, characters: [], skipped_names: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.autofillEpisodeCharacters('episode-1', { version: 8 })).resolves.toEqual({
      version: 8, characters: [], skipped_names: [],
    });
  });

  it('reads the persisted-autofill capability separately from the legacy suggestion capability', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.getCharacterAutofillCapabilities()).resolves.toEqual({ enabled: true });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/story/character-autofill-capabilities'),
      expect.any(Object),
    );
  });
});
