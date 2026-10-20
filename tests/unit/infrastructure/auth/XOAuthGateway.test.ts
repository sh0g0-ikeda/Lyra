import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { XOAuthGateway } from '../../../../src/infrastructure/auth/XOAuthGateway.js';

const config = {
  clientId: 'x-client',
  clientSecret: 'x-secret',
  redirectUri: 'https://auth.example.com/auth/x/callback',
};
const verifier = 'v'.repeat(64);
const state = 's'.repeat(48);

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function successfulFetcher(): ReturnType<typeof vi.fn> {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse({
      access_token: 'x-access-token-value',
      token_type: 'bearer',
      expires_in: 7200,
      scope: 'users.email users.read',
    }))
    .mockResolvedValueOnce(jsonResponse({
      data: {
        id: '2244994945',
        confirmed_email: 'Owner@Example.COM',
        name: 'X Owner',
      },
    }));
}

// Spec 4/8: the bridge requests only identity scopes, performs one bounded
// exchange, and accepts only a complete confirmed identity from X.
describe('X OAuth identity gateway', () => {
  it('固定 endpoint と S256 PKCE だけで認可 URL を作る', () => {
    const fetcher = vi.fn(async (): Promise<Response> => jsonResponse({}));
    const gateway = new XOAuthGateway(config, { fetcher: fetcher as unknown as typeof fetch });

    const url = new URL(gateway.buildAuthorizationUrl(state, verifier));

    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: 'users.read users.email',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
  });

  it('code を一度交換し confirmed_email と numeric subject を返す', async () => {
    const fetcher = successfulFetcher();
    const gateway = new XOAuthGateway(config, { fetcher: fetcher as unknown as typeof fetch });

    await expect(gateway.exchange('authorization-code', verifier)).resolves.toEqual({
      subject: '2244994945',
      email: 'owner@example.com',
      name: 'X Owner',
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://api.x.com/2/oauth2/token');
    expect(tokenInit).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(tokenInit.headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from('x-client:x-secret').toString('base64')}`,
    });
    const tokenBody = new URLSearchParams(String(tokenInit.body));
    expect(Object.fromEntries(tokenBody)).toEqual({
      grant_type: 'authorization_code',
      code: 'authorization-code',
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    });
    expect(String(tokenInit.body)).not.toContain(config.clientSecret);

    const [profileUrl, profileInit] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(profileUrl).toBe('https://api.x.com/2/users/me?user.fields=confirmed_email');
    expect(profileInit).toMatchObject({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(profileInit.headers).toEqual({ authorization: 'Bearer x-access-token-value' });
  });

  it.each([
    undefined,
    '',
    'users.read',
    'users.email',
    'users.read users.email offline.access',
    'users.read users.email tweet.read',
  ])('必要 scope 以外が返った場合に拒否する: %s', async (scope) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      access_token: 'x-access-token-value',
      token_type: 'bearer',
      expires_in: 7200,
      ...(scope === undefined ? {} : { scope }),
    }));
    const gateway = new XOAuthGateway(config, { fetcher: fetcher as unknown as typeof fetch });

    await expect(gateway.exchange('authorization-code', verifier)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'X identity proof could not be verified',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { access_token: '', token_type: 'bearer', expires_in: 7200, scope: 'users.read users.email' },
    { access_token: 'x-access-token-value', token_type: 'mac', expires_in: 7200, scope: 'users.read users.email' },
    { access_token: 'x-access-token-value', token_type: 'bearer', expires_in: 0, scope: 'users.read users.email' },
    { access_token: 'x-access-token-value', token_type: 'bearer', expires_in: 100_000, scope: 'users.read users.email' },
  ])('不完全な token response を拒否する %#', async (tokenResponse) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(tokenResponse));
    await expect(new XOAuthGateway(config, { fetcher: fetcher as unknown as typeof fetch }).exchange('authorization-code', verifier))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: { id: 'abc', confirmed_email: 'owner@example.com', name: 'Owner' } },
    { data: { id: '2244994945', name: 'Owner' } },
    { data: { id: '2244994945', confirmed_email: 'invalid', name: 'Owner' } },
    { data: { id: '2244994945', confirmed_email: 'owner@example.com', name: '' } },
    { data: { id: '2244994945', confirmed_email: 'owner@example.com', name: 'Owner' }, errors: [{ title: 'partial' }] },
  ])('不完全または部分成功の profile を拒否する %#', async (profileResponse) => {
    const fetcher = successfulFetcher();
    fetcher.mockReset()
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'x-access-token-value', token_type: 'bearer', expires_in: 7200, scope: 'users.read users.email',
      }))
      .mockResolvedValueOnce(jsonResponse(profileResponse));

    await expect(new XOAuthGateway(config, { fetcher: fetcher as unknown as typeof fetch }).exchange('authorization-code', verifier))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('provider failure を再試行せず診断を隠す', async () => {
    const fetcher = vi.fn(async (): Promise<Response> => {
      throw new Error('private provider diagnostic');
    });

    await expect(new XOAuthGateway(config, { fetcher: fetcher as unknown as typeof fetch }).exchange('authorization-code', verifier))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'X identity proof could not be verified' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
