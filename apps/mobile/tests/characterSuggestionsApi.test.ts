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
      expect.stringContaining('/api/episodes/episode-1/character-autofill?organization_id=organization-1'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 8 }) }),
    );
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
