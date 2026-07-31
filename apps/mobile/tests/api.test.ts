import { describe, expect, it, vi } from 'vitest';
import type { AuthTokens } from '../src/domain/auth';
import {
  ApiError,
  LyraMobileApiClient,
  type MobileAuthSessionPort,
} from '../src/lib/api';

describe('LyraMobileApiClient', () => {
  it('ID tokenで/api/meを取得しcanonical schemaで検証する', async () => {
    const auth = new FakeAuthSession();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(buildCurrentSession()),
    );
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher,
    });

    await expect(api.getCurrentSession()).resolves.toEqual(buildCurrentSession());
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/api/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer id-token',
        }),
      }),
    );
  });

  it('401ではrefreshを1回だけ行って再試行する', async () => {
    const auth = new FakeAuthSession();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse(buildCurrentSession()));
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com/',
      auth,
      fetcher,
    });

    await expect(api.getCurrentSession()).resolves.toEqual(buildCurrentSession());
    expect(auth.refreshCalls).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer refreshed-id-token',
        }),
      }),
    );
  });

  it('不正payloadとserver bodyを安定した安全なerrorへ変換する', async () => {
    const auth = new FakeAuthSession();
    const invalidApi = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ user: null })),
    });
    const failedApi = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('provider secret stack', { status: 500 }),
      ),
    });

    await expect(invalidApi.getCurrentSession()).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      status: 502,
    });
    await expect(failedApi.getCurrentSession()).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ApiError
        && error.code === 'SERVER_ERROR'
        && !error.message.includes('provider secret stack'),
    );
  });

  it('API通信を上限時間で中断する', async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | null = null;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          receivedSignal = init?.signal ?? null;
          receivedSignal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const api = new LyraMobileApiClient({
      apiBaseUrl: 'https://api.example.com',
      auth: new FakeAuthSession(),
      fetcher,
      requestTimeoutMs: 100,
    });

    const request = api.getCurrentSession();
    const rejection = expect(request).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(receivedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});

class FakeAuthSession implements MobileAuthSessionPort {
  public refreshCalls = 0;
  private tokens: AuthTokens = buildTokens('id-token');

  public async getTokens(): Promise<AuthTokens | null> {
    return this.tokens;
  }

  public async refreshTokens(): Promise<AuthTokens> {
    this.refreshCalls += 1;
    this.tokens = buildTokens('refreshed-id-token');
    return this.tokens;
  }
}

function buildTokens(idToken: string): AuthTokens {
  return {
    idToken,
    accessToken: null,
    refreshToken: 'refresh-token',
    expiresAt: 1_800_000_000_000,
    tokenType: 'Bearer',
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildCurrentSession(): Record<string, unknown> {
  return {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
      display_name: null,
      plan_code: 'free',
    },
    personal_credits: {
      monthly_credits: 10,
      purchased_credits: 2,
      total_credits: 12,
      monthly_expires_at: null,
    },
    organizations: [],
  };
}
