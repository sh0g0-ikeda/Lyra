import { describe, expect, it, vi } from 'vitest';

import { ApnsPushProvider } from '../../../../src/infrastructure/push/ApnsPushProvider.js';

const message = {
  platform: 'ios' as const,
  deviceToken: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  title: '生成が完了しました',
  body: 'アプリで結果を確認できます。',
  data: {
    job_id: '11111111-1111-4111-8111-111111111111',
    organization_id: null,
    target_tab: 'Characters' as const,
    work_id: '22222222-2222-4222-8222-222222222222',
    entity_id: '33333333-3333-4333-8333-333333333333',
  },
};

describe('ApnsPushProvider', () => {
  it('APNsへalertと不透明なrouting IDだけを送信する', async () => {
    const transport = {
      send: vi.fn().mockResolvedValue({ statusCode: 200, body: '' }),
    };
    const tokenProvider = { getToken: vi.fn().mockResolvedValue('signed-provider-jwt') };
    const provider = new ApnsPushProvider(
      {
        bundleId: 'jp.lyra.mobile',
        environment: 'production',
        timeoutMs: 5_000,
      },
      transport,
      tokenProvider,
    );

    await expect(provider.send(message)).resolves.toEqual({ outcome: 'sent' });
    expect(transport.send).toHaveBeenCalledWith({
      authority: 'https://api.push.apple.com',
      path: `/3/device/${message.deviceToken}`,
      headers: {
        authorization: 'bearer signed-provider-jwt',
        'apns-topic': 'jp.lyra.mobile',
        'apns-push-type': 'alert',
        'apns-priority': '10',
      },
      body: JSON.stringify({
        aps: {
          alert: { title: message.title, body: message.body },
          sound: 'default',
        },
        job_id: message.data.job_id,
        target_tab: 'Characters',
        work_id: message.data.work_id,
        entity_id: message.data.entity_id,
      }),
      timeoutMs: 5_000,
    });
    expect(JSON.stringify(transport.send.mock.calls)).not.toMatch(/story|dialogue|email|image/iu);
  });

  it.each([
    [400, '{"reason":"BadDeviceToken"}'],
    [400, '{"reason":"DeviceTokenNotForTopic"}'],
    [410, '{"reason":"Unregistered"}'],
  ])('APNs %s の無効token応答を削除対象に分類する', async (statusCode, body) => {
    const provider = buildProvider({ statusCode, body });
    await expect(provider.send(message)).resolves.toEqual({ outcome: 'invalid_token' });
  });

  it.each([429, 500, 503])(
    'APNs %s はretryable failureに分類する',
    async (statusCode) => {
      const provider = buildProvider({ statusCode, body: '{"reason":"ServiceUnavailable"}' });
      await expect(provider.send(message)).rejects.toMatchObject({
        code: statusCode === 429 ? 'apns_rate_limited' : 'apns_unavailable',
        retryable: true,
      });
    },
  );

  it('APNsの認証拒否は永久失敗に分類しprovider本文を例外へ含めない', async () => {
    const provider = buildProvider({
      statusCode: 403,
      body: '{"reason":"InvalidProviderToken","secret":"must-not-leak"}',
    });

    await expect(provider.send(message)).rejects.toMatchObject({
      code: 'apns_rejected',
      retryable: false,
      message: 'apns_rejected',
    });
  });
});

function buildProvider(response: { statusCode: number; body: string }): ApnsPushProvider {
  return new ApnsPushProvider(
    {
      bundleId: 'jp.lyra.mobile',
      environment: 'sandbox',
      timeoutMs: 5_000,
    },
    { send: vi.fn().mockResolvedValue(response) },
    { getToken: vi.fn().mockResolvedValue('signed-provider-jwt') },
  );
}
