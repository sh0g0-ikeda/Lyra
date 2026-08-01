import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';

describe('LyraMobileApiClient.moveEpisode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('章境界移動時だけcross_chapterを送る', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'episode-1',
      chapter_id: 'chapter-2',
      order: 1,
      title: '第一話',
      purpose: null,
      story_input_mode: 'full',
      story_full_draft: null,
      introduction: null,
      middle: null,
      climax: null,
      ending_hook: null,
      estimated_pages: 4,
      entities_involved: [],
      page_skeleton_generated: false,
      version: 2,
      status: 'draft',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z'
    }), {
      headers: { 'content-type': 'application/json' },
      status: 200
    }));
    vi.stubGlobal('fetch', fetcher);
    const client = new LyraMobileApiClient(() => 'token');

    await client.moveEpisode('episode-1', 'down', 'organization-1', true);

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/api/episodes/episode-1/move?organization_id=organization-1'),
      expect.objectContaining({
        body: JSON.stringify({ direction: 'down', cross_chapter: true }),
        method: 'POST'
      })
    );
  });
});
