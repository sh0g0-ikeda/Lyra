import { afterEach, describe, expect, it, vi } from 'vitest';

import { LyraMobileApiClient } from '@/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('production notes capability API', () => {
  it('reads the opt-in capability from its additive endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new LyraMobileApiClient(() => 'token').getProductionNotesCapabilities())
      .resolves.toEqual({ enabled: true });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/story/production-notes-capabilities'),
      expect.any(Object),
    );
  });
});
