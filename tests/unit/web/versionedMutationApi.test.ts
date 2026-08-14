import { afterEach, describe, expect, it, vi } from 'vitest';
import { LyraApiClient } from '../../../apps/web/src/lib/api.js';

interface CapturedRequest {
  body: Record<string, unknown>;
  method: string | undefined;
  url: string;
}

describe('Web versioned mutation API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('更新APIの場合に表示中レコードの更新時刻と組織スコープを必ず送る', async () => {
    const requests: CapturedRequest[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        method: init?.method,
        url: String(input),
      });
      return new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }));

    const api = new LyraApiClient(() => 'test-token');
    const options = {
      expectedUpdatedAt: '2026-08-14T01:02:03.456Z',
      organizationId: 'organization / 1',
    };

    await api.updateWork('work-1', { title: '作品' }, options);
    await api.updateChapter('chapter-1', { title: '章' }, options);
    await api.updateEpisode('episode-1', { title: '話' }, options);
    await api.updateEntity('entity-1', { name: '人物' }, options);
    await api.updatePage('page-1', { page_number: 2 }, options);

    expect(requests).toHaveLength(5);
    for (const request of requests) {
      expect(request.method).toBe('PUT');
      expect(request.url).toContain('?organization_id=organization%20%2F%201');
      expect(request.body.expected_updated_at).toBe('2026-08-14T01:02:03.456Z');
    }
    expect(requests.map((request) => request.body)).toEqual([
      { title: '作品', expected_updated_at: '2026-08-14T01:02:03.456Z' },
      { title: '章', expected_updated_at: '2026-08-14T01:02:03.456Z' },
      { title: '話', expected_updated_at: '2026-08-14T01:02:03.456Z' },
      { name: '人物', expected_updated_at: '2026-08-14T01:02:03.456Z' },
      { page_number: 2, expected_updated_at: '2026-08-14T01:02:03.456Z' },
    ]);
  });
});
