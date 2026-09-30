import { describe, expect, it, vi } from 'vitest';
import { LyraApiClient } from '../../../apps/web/src/lib/api.js';

describe('Webページ生成API', () => {
  it('白黒指定の場合にrender_styleを送り、通常生成はbodyを省略する', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ job_id: 'job-1' }), { status: 202 }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const api = new LyraApiClient(() => 'token');
      await api.generatePage('page-1', 'org-1', 'monochrome');
      await api.generatePage('page-1', 'org-1');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/pages/page-1/generate?organization_id=org-1');
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ render_style: 'monochrome' });
      expect(fetchMock.mock.calls[1]?.[1]?.body).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
