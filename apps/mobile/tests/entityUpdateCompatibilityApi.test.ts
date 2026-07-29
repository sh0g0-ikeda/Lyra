import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';

const updatedEntity = {
  id: '11111111-1111-4111-8111-111111111111',
  work_id: '22222222-2222-4222-8222-222222222222',
  entity_type: 'character',
  name: '蓮',
  free_description: null,
  prompt_supplement: null,
  structured_fields: {},
  speech_profile: {},
  status: 'draft',
  created_at: '2026-07-29T00:00:00.000Z',
  updated_at: '2026-07-29T00:01:00.000Z',
};

describe('entity update API compatibility', () => {
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
                "Validation failed: Unrecognized key(s) in object: 'expected_updated_at'",
            },
          }),
          { status: 422 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(updatedEntity), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.updateEntity(updatedEntity.id, {
        expected_updated_at: '2026-07-29T00:00:00.000Z',
        name: '蓮',
      }),
    ).resolves.toEqual(updatedEntity);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      expected_updated_at: '2026-07-29T00:00:00.000Z',
      name: '蓮',
    });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      name: '蓮',
    });
  });

  it('通常の入力不整合では再送しない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed: name: String must contain at least 1 character(s)',
          },
        }),
        { status: 422 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await expect(
      client.updateEntity(updatedEntity.id, {
        expected_updated_at: '2026-07-29T00:00:00.000Z',
        name: '',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('現行APIが受理した場合は一度だけ送信する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(updatedEntity), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new LyraMobileApiClient(() => 'token');

    await client.updateEntity(updatedEntity.id, {
      expected_updated_at: '2026-07-29T00:00:00.000Z',
      name: '蓮',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
