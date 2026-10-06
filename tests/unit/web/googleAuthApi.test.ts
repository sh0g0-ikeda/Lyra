import { createGlobalStubScope } from './googleTestGlobals.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
const globals = createGlobalStubScope();

interface GoogleCapabilityClient {
  getGoogleAuthCapabilities(): Promise<unknown>;
}

async function createClient(): Promise<GoogleCapabilityClient> {
  // Keep Vite's import.meta.env inside the Web typecheck boundary while this
  // backend NodeNext suite still exercises the real browser API client.
  const modulePath = '../../../apps/web/src/lib/api.js';
  const { LyraApiClient } = await import(modulePath) as {
    LyraApiClient: new (tokenProvider: () => null) => GoogleCapabilityClient;
  };
  return new LyraApiClient(() => null);
}

afterEach(() => globals.restore());

describe('Web Google capability negotiation', () => {
  it('v2を明示取得してreview済みiOS capabilityを受け取る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      version: 2,
      google_sign_in: true,
      google_linking: true,
      google_ios: true,
    })));
    globals.stubGlobal('fetch', fetchMock);
    await expect((await createClient()).getGoogleAuthCapabilities()).resolves.toMatchObject({ version: 2, google_ios: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/capabilities?version=2');
  });

  it('旧serverのv1 responseをiOS有効として解釈しない', async () => {
    globals.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      google_sign_in: true,
      google_linking: true,
      google_ios: false,
    }))));
    await expect((await createClient()).getGoogleAuthCapabilities()).rejects.toThrow();
  });
});
