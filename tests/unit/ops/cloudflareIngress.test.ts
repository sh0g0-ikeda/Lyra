import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { handleRequest, type OriginFetch, type OriginFetchInit } from '../../../ops/cloudflare/ingress-worker.js';

const APP = 'https://app.lyra-editor.com';
const STATIC = 'https://d1a1300ysx6i1r.cloudfront.net';
const ENV = { LYRA_ORIGIN_GUARD: 'operator-secret' };
const originalFetch = globalThis.fetch;

function request(path = '/api/works', init?: RequestInit): Request {
  return new Request(APP + path, init);
}

function upstream(response: Response = new Response('ok')): {
  fetcher: OriginFetch;
  calls: Array<{ request: Request; init: OriginFetchInit }>;
} {
  const calls: Array<{ request: Request; init: OriginFetchInit }> = [];
  return {
    calls,
    fetcher: async (sent, init): Promise<Response> => {
      calls.push({ request: sent, init });
      return response;
    },
  };
}

describe('Cloudflare ingress', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('Worker本番entrypointの場合に実行contextをfetch関数と混同しない', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async (): Promise<Response> => new Response('entrypoint'));
    globalThis.fetch = fetcher;
    const platformHandler: (input: Request, env: { LYRA_ORIGIN_GUARD?: string }, context: unknown) => Promise<Response> = worker.fetch;
    const response = await platformHandler(request(), ENV, { waitUntil: (): void => {} });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('entrypoint');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '', '   ', 'bad\r\nvalue'])('secretが不正な場合に全経路が503になり外部通信しない (%s)', async (secret) => {
    const origin = upstream();
    for (const path of ['/api/works', '/privacy.html']) {
      const response = await handleRequest(request(path), { LYRA_ORIGIN_GUARD: secret }, origin.fetcher);
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).not.toContain('operator-secret');
    }
    expect(origin.calls).toHaveLength(0);
  });

  it.each(['203.0.113.17', '2001:db8::1', '::1', '::', '2001:db8:0:1:2:3:4:5', '::ffff:192.0.2.128'])(
    '有効な接続IPの場合に偽装headerを上書きする (%s)',
    async (ip) => {
      const origin = upstream();
      await handleRequest(request('/api/works', { headers: {
        'CF-Connecting-IP': ip,
        'X-Lyra-Origin-Guard': 'visitor-secret',
        'CloudFront-Viewer-Address': '198.51.100.99:1234',
        'X-Forwarded-For': '192.0.2.5',
        'X-Real-IP': '192.0.2.6',
      } }), ENV, origin.fetcher);
      expect(origin.calls).toHaveLength(1);
      const sent = origin.calls[0]!.request;
      expect(sent.headers.get('X-Lyra-Origin-Guard')).toBe(ENV.LYRA_ORIGIN_GUARD);
      expect(sent.headers.get('CloudFront-Viewer-Address')).toBe(ip);
      expect(sent.headers.get('CF-Connecting-IP')).toBeNull();
      expect(sent.headers.get('X-Forwarded-For')).toBeNull();
      expect(sent.headers.get('X-Real-IP')).toBeNull();
    },
  );

  it.each([
    undefined, '', 'unknown', '999.1.2.3', '01.2.3.4', '1.2.3', '1.2.3.4:80',
    '1.2.3.4, 5.6.7.8', '[2001:db8::1]', 'fe80::1%eth0', '1::2::3',
    '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8::',
    '::ffff:999.2.3.4', '::ffff:01.2.3.4', 'gggg::1', '1:2:3:4:5:192.0.2.1',
  ])('接続IPが欠落または不正な場合にviewer headerを信用しない (%s)', async (ip) => {
    const headers = new Headers({ 'CloudFront-Viewer-Address': '203.0.113.88', 'X-Forwarded-For': '203.0.113.89' });
    if (ip !== undefined) headers.set('CF-Connecting-IP', ip);
    const origin = upstream();
    await handleRequest(request('/api/works', { headers }), ENV, origin.fetcher);
    expect(origin.calls).toHaveLength(1);
    expect(origin.calls[0]!.request.headers.get('CloudFront-Viewer-Address')).toBeNull();
    expect(origin.calls[0]!.request.headers.get('CF-Connecting-IP')).toBeNull();
  });

  it('APIへのPOSTでは認証とStripe署名と生bodyとqueryを保持する', async () => {
    const bytes = new Uint8Array([123, 32, 13, 10, 34, 120, 34, 58, 34, 195, 169, 34, 125]);
    const origin = upstream();
    await handleRequest(request('/api/webhooks/stripe?x=one%2Btwo&x=3', {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token', Cookie: 'session=private', 'Stripe-Signature': 't=1,v1=signature', 'Content-Type': 'application/json' },
      body: bytes,
    }), ENV, origin.fetcher);
    const sent = origin.calls[0]!.request;
    expect(sent.url).toBe(APP + '/api/webhooks/stripe?x=one%2Btwo&x=3');
    expect(sent.method).toBe('POST');
    expect(sent.headers.get('Authorization')).toBe('Bearer user-token');
    expect(sent.headers.get('Cookie')).toBe('session=private');
    expect(sent.headers.get('Stripe-Signature')).toBe('t=1,v1=signature');
    expect(sent.headers.get('Content-Type')).toBe('application/json');
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(bytes);
  });

  it.each(['/.well-known/assetlinks.json', '/privacy.html', '/terms.html', '/support.html', '/legal.css'])(
    '公開パスが完全一致の場合にqueryだけを保って資格情報なしでCloudFrontへ送る (%s)',
    async (path) => {
      const origin = upstream();
      await handleRequest(request(path + '?v=a%2Fb&v=2', { headers: {
        Authorization: 'Bearer private', Cookie: 'private=1', 'X-Lyra-Origin-Guard': 'forged',
        'CloudFront-Viewer-Address': '203.0.113.9', 'CF-Connecting-IP': '203.0.113.10',
        'Stripe-Signature': 'private', 'X-Api-Key': 'private', Accept: 'text/html', Range: 'bytes=0-50',
      } }), ENV, origin.fetcher);
      const sent = origin.calls[0]!.request;
      expect(sent.url).toBe(STATIC + path + '?v=a%2Fb&v=2');
      expect([...sent.headers.keys()].sort()).toEqual(['accept', 'range']);
      expect(sent.headers.get('Range')).toBe('bytes=0-50');
    },
  );

  it('公開パスへのHEADの場合にHEADを保持する', async () => {
    const origin = upstream(new Response(null));
    await handleRequest(request('/privacy.html', { method: 'HEAD' }), ENV, origin.fetcher);
    expect(origin.calls[0]!.request.method).toBe('HEAD');
  });

  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('公開パスへの%sの場合にCloudFront同様403で通信しない', async (method) => {
    const origin = upstream();
    const response = await handleRequest(request('/privacy.html', { method }), ENV, origin.fetcher);
    expect(response.status).toBe(403);
    expect(origin.calls).toHaveLength(0);
  });

  it.each(['/assets/main.js', '/privacy.html/other', '/privacy.htmlx', '/Privacy.html', '/privacy%2ehtml', '/.well-known/assetlinks.json/other', '/auth/callback?code=a%2Bb', '/'])(
    '公開パスに完全一致しない場合に同じAPI originへ送る (%s)',
    async (path) => {
      const origin = upstream();
      await handleRequest(request(path), ENV, origin.fetcher);
      expect(origin.calls[0]!.request.url).toBe(APP + path);
      expect(origin.calls[0]!.request.headers.get('X-Lyra-Origin-Guard')).toBe(ENV.LYRA_ORIGIN_GUARD);
    },
  );

  it.each([302, 307, 401, 403, 422, 429, 500, 503])('上流が%sの場合にstatusとLocationとbodyを保持して再試行しない', async (status) => {
    const bytes = new Uint8Array([0, 255, 17]);
    const origin = upstream(new Response(bytes, { status, headers: {
      Location: 'https://example.com/next', 'Content-Type': 'application/octet-stream', 'Retry-After': '12',
      'Set-Cookie': 'user-cookie=1; Secure',
    } }));
    const response = await handleRequest(request(), ENV, origin.fetcher);
    expect(response.status).toBe(status);
    expect(response.headers.get('Location')).toBe('https://example.com/next');
    expect(response.headers.get('Retry-After')).toBe('12');
    expect(response.headers.get('Set-Cookie')).toBe('user-cookie=1; Secure');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(origin.calls).toHaveLength(1);
    expect(origin.calls[0]!.request.redirect).toBe('manual');
  });

  it('API応答は上流のcache指定に関係なくcacheを禁止する', async () => {
    const origin = upstream(new Response('private', { headers: {
      'Cache-Control': 'public, max-age=600', 'CDN-Cache-Control': 'public, max-age=600',
      'Cloudflare-CDN-Cache-Control': 'public, max-age=600',
    } }));
    const response = await handleRequest(request(), ENV, origin.fetcher);
    expect(origin.calls[0]!.request.cache).toBe('no-store');
    expect(origin.calls[0]!.init.cf).toEqual({ cacheEverything: false, cacheTtlByStatus: { '100-599': -1 } });
    for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control']) {
      expect(response.headers.get(name)).toBe('no-store');
    }
  });

  it('上流が応答するまでは先行200を返さずSSEのbodyをbufferしない', async () => {
    let resolveOrigin: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => { resolveOrigin = resolve; });
    const fetcher = vi.fn<OriginFetch>(async () => pending);
    let settled = false;
    const result = handleRequest(request('/api/story/collaborate', { method: 'POST', body: '{}' }), ENV, fetcher);
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({ start(value): void { controller = value; } });
    resolveOrigin!(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    const response = await result;
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const frame = new TextEncoder().encode('event: chunk\ndata: {"text":"one"}\n\n');
    controller!.enqueue(frame);
    expect((await reader.read()).value).toEqual(frame);
    controller!.close();
    expect((await reader.read()).done).toBe(true);
  });

  it('上流network例外の場合に秘密を返さず一度だけ試行して502になる', async () => {
    const fetcher = vi.fn<OriginFetch>(async () => { throw new Error('operator-secret internal-url'); });
    const response = await handleRequest(request('/api/works', { method: 'POST', body: '{}' }), ENV, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toMatch(/operator-secret|internal-url/);
  });

  it.each([APP, 'https://lyra-tunnel-canary.lyra-editor.com'])(
    '明示許可originの場合に同じホストへのfetchを維持する (%s)',
    async (originUrl) => {
      const origin = upstream();
      const url = originUrl + '/api/works?cursor=a%2Bb';
      const response = await handleRequest(new Request(url), ENV, origin.fetcher);
      expect(response.status).toBe(200);
      expect(origin.calls).toHaveLength(1);
      expect(origin.calls[0]!.request.url).toBe(url);
      expect(origin.calls[0]!.request.headers.get('X-Lyra-Origin-Guard')).toBe(ENV.LYRA_ORIGIN_GUARD);
    },
  );
  it.each(['https://attacker.example/api/works', 'http://app.lyra-editor.com/api/works', 'https://other-canary.lyra-editor.com/api/works', 'http://lyra-tunnel-canary.lyra-editor.com/api/works'])(
    '許可していないoriginの場合に外部通信しない (%s)',
    async (url) => {
      const origin = upstream();
      const response = await handleRequest(new Request(url), ENV, origin.fetcher);
      expect(response.status).toBe(404);
      expect(origin.calls).toHaveLength(0);
    },
  );
});
