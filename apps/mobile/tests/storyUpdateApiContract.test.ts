import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';

const updatedEpisode = {
  id: '11111111-1111-4111-8111-111111111111',
  chapter_id: '22222222-2222-4222-8222-222222222222',
  order: 1,
  title: '第1話',
  purpose: null,
  story_input_mode: 'full' as const,
  story_full_draft: '保存後の本文',
  introduction: null,
  middle: null,
  climax: null,
  ending_hook: null,
  estimated_pages: 8,
  entities_involved: [],
  page_skeleton_generated: false,
  version: 2,
  status: 'draft' as const,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-02T00:00:00.000Z'
};

const updatedWork = {
  id: '33333333-3333-4333-8333-333333333333',
  organization_id: null,
  title: '保存後の作品',
  genre: null,
  world_setting: null,
  theme: null,
  main_entity_ids: [],
  starting_point: null,
  ending_point: null,
  overall_flow: null,
  version: 2,
  status: 'draft' as const,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-02T00:00:00.000Z'
};

const updatedChapter = {
  id: '44444444-4444-4444-8444-444444444444',
  work_id: updatedWork.id,
  order: 1,
  title: '保存後の章',
  purpose: null,
  starting_state: null,
  ending_state: null,
  emotion_curve: null,
  entities_involved: [],
  key_beats: [],
  version: 2,
  status: 'draft' as const,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-02T00:00:00.000Z'
};

describe('story update API contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('episode保存ではclient内部の更新時刻を現行backendへ送らない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(updatedEpisode), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.updateEpisode(updatedEpisode.id, {
      expected_updated_at: '2026-08-01T12:00:00.000Z',
      estimated_pages: 8,
      story_full_draft: '保存後の本文',
      story_input_mode: 'full',
      title: '第1話'
    })).resolves.toEqual(updatedEpisode);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      estimated_pages: 8,
      story_full_draft: '保存後の本文',
      story_input_mode: 'full',
      title: '第1話'
    });
  });

  it.each([
    {
      label: 'work',
      response: updatedWork,
      run: (client: LyraMobileApiClient) => client.updateWork(updatedWork.id, {
        expected_updated_at: '2026-08-01T12:00:00.000Z',
        title: updatedWork.title
      })
    },
    {
      label: 'chapter',
      response: updatedChapter,
      run: (client: LyraMobileApiClient) => client.updateChapter(updatedChapter.id, {
        expected_updated_at: '2026-08-01T12:00:00.000Z',
        title: updatedChapter.title
      })
    }
  ])('$label保存でもclient内部の更新時刻を現行backendへ送らない', async ({ response, run }) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(run(client)).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      title: response.title
    });
  });
});
