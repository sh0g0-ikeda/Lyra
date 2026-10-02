import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Web job contract negotiation', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  it('opts into import analysis for detail and cancel while preserving organization scope', async () => {
    // A runtime module path keeps browser-only import.meta.env out of the
    // backend NodeNext compilation; both supported test runners load real code.
    const modulePath = '../../../apps/web/src/lib/api.js';
    const { LyraApiClient } = await import(modulePath) as {
      LyraApiClient: new (tokenProvider: () => string) => {
        getJob: (id: string, organizationId: string) => Promise<unknown>;
        cancelJob: (id: string, organizationId: string) => Promise<unknown>;
      };
    };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: 'job-1', job_type: 'entity_import_analysis', status: 'completed', result: null }), { status: 200, headers: { 'content-type': 'application/json' } }));
    globalThis.fetch = fetchMock as typeof fetch;
    const client = new LyraApiClient(() => 'token');
    await client.getJob('job-1', 'organization-1');
    await client.cancelJob('job-1', 'organization-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toContain('job_contract=v2');
      expect(String(url)).toContain('organization_id=organization-1');
    }
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' });
  });
});
