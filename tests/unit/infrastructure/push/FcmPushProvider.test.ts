import { describe, expect, it, vi } from 'vitest';

import { FcmPushProvider } from '../../../../src/infrastructure/push/FcmPushProvider.js';

const message = {
  platform: 'android' as const,
  deviceToken: 'fcm-native-device-token-0123456789',
  title: 'Generation completed',
  body: 'Open the app to review the result.',
  data: {
    job_id: '11111111-1111-4111-8111-111111111111',
    organization_id: '22222222-2222-4222-8222-222222222222',
    target_tab: 'Pages' as const,
    work_id: '33333333-3333-4333-8333-333333333333',
    chapter_id: '44444444-4444-4444-8444-444444444444',
    episode_id: '55555555-5555-4555-8555-555555555555',
    page_id: '66666666-6666-4666-8666-666666666666',
  },
};

describe('FcmPushProvider', () => {
  it('FCM HTTP v1へ文字列routing dataとgeneric copyを送信する', async () => {
    const http = {
      post: vi.fn().mockResolvedValue({ statusCode: 200, body: '{"name":"ok"}' }),
    };
    const accessTokenProvider = {
      getAccessToken: vi.fn().mockResolvedValue('oauth-access-token'),
    };
    const provider = new FcmPushProvider(
      { projectId: 'lyra-production', timeoutMs: 5_000 },
      http,
      accessTokenProvider,
    );

    await expect(provider.send(message)).resolves.toEqual({ outcome: 'sent' });
    expect(http.post).toHaveBeenCalledWith({
      url: 'https://fcm.googleapis.com/v1/projects/lyra-production/messages:send',
      authorization: 'Bearer oauth-access-token',
      body: JSON.stringify({
        message: {
          token: message.deviceToken,
          notification: { title: message.title, body: message.body },
          data: {
            job_id: message.data.job_id,
            organization_id: message.data.organization_id,
            target_tab: 'Pages',
            work_id: message.data.work_id,
            chapter_id: message.data.chapter_id,
            episode_id: message.data.episode_id,
            page_id: message.data.page_id,
          },
          android: {
            priority: 'high',
            notification: { channel_id: 'job-status' },
          },
        },
      }),
      timeoutMs: 5_000,
    });
  });

  it.each([
    [404, '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}'],
    [400, '{"error":{"status":"INVALID_ARGUMENT","details":[{"errorCode":"UNREGISTERED"}]}}'],
  ])('FCMの無効token応答を削除対象に分類する', async (statusCode, body) => {
    await expect(buildProvider({ statusCode, body }).send(message)).resolves.toEqual({
      outcome: 'invalid_token',
    });
  });

  it.each([429, 500, 503])(
    'FCM %s はretryable failureに分類する',
    async (statusCode) => {
      const provider = buildProvider({ statusCode, body: '{"error":{"status":"UNAVAILABLE"}}' });
      await expect(provider.send(message)).rejects.toMatchObject({
        code: statusCode === 429 ? 'fcm_rate_limited' : 'fcm_unavailable',
        retryable: true,
      });
    },
  );

  it('FCMの権限拒否は永久失敗に分類し応答本文を例外へ含めない', async () => {
    const provider = buildProvider({
      statusCode: 403,
      body: '{"error":{"message":"service account secret must-not-leak"}}',
    });
    await expect(provider.send(message)).rejects.toMatchObject({
      code: 'fcm_rejected',
      retryable: false,
      message: 'fcm_rejected',
    });
  });

  it('FCM OAuth SDKの生エラーを安全なretryable failureへ正規化する', async () => {
    const provider = new FcmPushProvider(
      { projectId: 'lyra-production', timeoutMs: 5_000 },
      { post: vi.fn() },
      {
        getAccessToken: vi.fn().mockRejectedValue(
          new Error('private service-account detail must-not-leak'),
        ),
      },
    );

    await expect(provider.send(message)).rejects.toMatchObject({
      code: 'fcm_auth_unavailable',
      retryable: true,
      message: 'fcm_auth_unavailable',
    });
  });

  it('FCM OAuth token取得がtimeoutを超えたら有限時間でretryable failureにする', async () => {
    vi.useFakeTimers();
    try {
      const http = { post: vi.fn() };
      const provider = new FcmPushProvider(
        { projectId: 'lyra-production', timeoutMs: 100 },
        http,
        { getAccessToken: vi.fn(() => new Promise<string>(() => undefined)) },
      );

      const sending = provider.send(message);
      const assertion = expect(sending).rejects.toMatchObject({
        code: 'fcm_auth_timeout',
        retryable: true,
        message: 'fcm_auth_timeout',
      });
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      expect(http.post).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

function buildProvider(response: { statusCode: number; body: string }): FcmPushProvider {
  return new FcmPushProvider(
    { projectId: 'lyra-production', timeoutMs: 5_000 },
    { post: vi.fn().mockResolvedValue(response) },
    { getAccessToken: vi.fn().mockResolvedValue('oauth-access-token') },
  );
}
