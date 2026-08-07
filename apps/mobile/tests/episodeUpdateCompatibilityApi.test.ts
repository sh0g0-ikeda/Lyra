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

const updatePayload = {
  expected_updated_at: '2026-08-01T12:00:00.000Z',
  estimated_pages: 8,
  story_full_draft: '保存後の本文',
  story_input_mode: 'full' as const,
  title: '第1話'
};

describe('episode update API compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('旧APIがexpected_updated_atを未知の項目として拒否した場合だけ項目を外して再送する', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message:
                "Validation failed: Unrecognized key(s) in object: 'expected_updated_at'"
            }
          }),
          { status: 422 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(updatedEpisode), { status: 200 })
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.updateEpisode(updatedEpisode.id, updatePayload)).resolves.toEqual(
      updatedEpisode
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(updatePayload);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      estimated_pages: 8,
      story_full_draft: '保存後の本文',
      story_input_mode: 'full',
      title: '第1話'
    });
  });

  it('通常の入力不整合では再送しない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed: title: String must contain at least 1 character(s)'
          }
        }),
        { status: 422 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.updateEpisode(updatedEpisode.id, updatePayload)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('現行APIがexpected_updated_atを受理した場合は一度だけ送信する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(updatedEpisode), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(client.updateEpisode(updatedEpisode.id, updatePayload)).resolves.toEqual(
      updatedEpisode
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
