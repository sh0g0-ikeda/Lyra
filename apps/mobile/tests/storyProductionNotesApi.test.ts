import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';

const response = {
  draft: {
    title: null, purpose: null, story_input_mode: 'full', story_full_draft: '改善後の本文',
    introduction: null, middle: null, climax: null, ending_hook: null,
  },
  compiler_provider: 'openai', compiler_model: 'gpt-5', compiler_prompt_version: 'v1', compiler_error: null,
  production_notes: ['扉を押すとのぞくは同じコマにする'],
};

afterEach(() => vi.unstubAllGlobals());

describe('Story AI production-note contract', () => {
  it('capability対応時だけ明示opt-inを送り提案を受け取る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new LyraMobileApiClient(() => 'token');

    const result = await api.improveEpisodeDraft({
      episode_id: '11111111-1111-4111-8111-111111111111', instruction: '改善', language: 'ja',
      include_production_notes: true,
      base_draft: { title: null, purpose: null, story_input_mode: 'full', story_full_draft: '本文', introduction: null, middle: null, climax: null, ending_hook: null },
    });

    expect(result.production_notes).toEqual(['扉を押すとのぞくは同じコマにする']);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ include_production_notes: true });
  });

  it('旧server互換の改善要求には新しいfieldを送らない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...response, production_notes: undefined }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new LyraMobileApiClient(() => 'token');

    await api.improveEpisodeDraft({
      episode_id: '11111111-1111-4111-8111-111111111111', instruction: '改善', language: 'ja',
      base_draft: { title: null, purpose: null, story_input_mode: 'full', story_full_draft: '本文', introduction: null, middle: null, climax: null, ending_hook: null },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).include_production_notes).toBeUndefined();
  });
});
