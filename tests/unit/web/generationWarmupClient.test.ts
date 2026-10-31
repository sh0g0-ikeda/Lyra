import { afterEach, describe, expect, it, vi } from 'vitest';

const webApiModulePath = '../../../apps/web/src/lib/api.ts';

interface WarmupGate {
  request(
    input: { eligible: boolean; pageId: string | null; organizationId?: string | null },
    warm: (pageId: string, organizationId?: string | null) => Promise<void>,
  ): Promise<void>;
}

interface WebApiModule {
  LyraApiClient: new (tokenProvider: () => string) => {
    warmPageGeneration(pageId: string, organizationId?: string | null): Promise<void>;
  };
  createPageGenerationWarmupGate(): WarmupGate;
  runBestEffortPageGenerationWarmup(warm: () => Promise<void>): Promise<void>;
}

async function loadWebApiModule(): Promise<WebApiModule> {
  // Keep the browser client outside the backend tsconfig graph while Vitest
  // still resolves and executes the real module at runtime.
  return await import(webApiModulePath) as WebApiModule;
}

async function createClient(): Promise<InstanceType<WebApiModule['LyraApiClient']>> {
  const webApiModule = await loadWebApiModule();
  return new webApiModule.LyraApiClient(() => 'token');
}

describe('LyraApiClient generation warmup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('生成warmupは課金bodyなしで認証済みpage scopeへ送る', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const client = await createClient();

    await expect(
      client.warmPageGeneration('page-1', 'organization-1')
    ).resolves.toBeUndefined();

    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toContain(
      '/api/pages/page-1/generation-warmup?organization_id=organization-1'
    );
    expect(request?.[1]).toMatchObject({ method: 'POST' });
    expect(request?.[1]?.body).toBeUndefined();
    expect(new Headers(request?.[1]?.headers).get('Authorization')).toBe('Bearer token');
  });

  it('生成warmupは旧backendの404を生成阻害エラーにしない', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const client = await createClient();

    await expect(client.warmPageGeneration('page-1')).resolves.toBeUndefined();
  });

  it('対象外は送信せず同じscopeとpageは再描画しても1回だけwarmupする', async () => {
    const webApiModule = await loadWebApiModule();
    const gate = webApiModule.createPageGenerationWarmupGate();
    const warm = vi.fn(async (_pageId: string, _organizationId?: string | null) => undefined);

    await gate.request({ eligible: false, pageId: 'page-1' }, warm);
    await Promise.all([
      gate.request({ eligible: true, pageId: 'page-1' }, warm),
      gate.request({ eligible: true, pageId: 'page-1' }, warm),
    ]);
    await gate.request({ eligible: true, pageId: 'page-2' }, warm);
    await gate.request({ eligible: true, pageId: 'page-1', organizationId: 'org-1' }, warm);

    expect(warm.mock.calls).toEqual([
      ['page-1', undefined],
      ['page-2', undefined],
      ['page-1', 'org-1'],
    ]);
  });

  it('warmup失敗は生成操作へ例外を返さない', async () => {
    const webApiModule = await loadWebApiModule();
    await expect(
      webApiModule.runBestEffortPageGenerationWarmup(async () => {
        throw new Error('warmup unavailable');
      }),
    ).resolves.toBeUndefined();
  });
});
