import { describe, expect, it, vi } from 'vitest';

import { PushProviderError } from '../../../../src/services/notification/NativePushProvider.js';
import { PushNotificationDeliveryService } from '../../../../src/services/notification/PushNotificationDeliveryService.js';

const delivery = {
  deliveryId: '11111111-1111-4111-8111-111111111111',
  pushTokenId: '22222222-2222-4222-8222-222222222222',
  leaseToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: '33333333-3333-4333-8333-333333333333',
  platform: 'ios' as const,
  locale: 'ja' as const,
  tokenCiphertext: 'v1.opaque',
  encryptionKeyId: 'push-key-v1',
  jobStatus: 'completed' as const,
  attemptCount: 1,
  navigation: {
    job_id: '44444444-4444-4444-8444-444444444444',
    organization_id: null,
    target_tab: 'Characters' as const,
    work_id: '55555555-5555-4555-8555-555555555555',
    entity_id: '66666666-6666-4666-8666-666666666666',
  },
};

describe('PushNotificationDeliveryService', () => {
  it('tokenを送信時だけ復号し、成功した端末deliveryを完了にする', async () => {
    const repository = buildRepository([delivery]);
    const cipher = { decrypt: vi.fn().mockResolvedValue('native-token-secret') };
    const provider = { send: vi.fn().mockResolvedValue({ outcome: 'sent' }) };
    const service = new PushNotificationDeliveryService(repository, cipher, provider, {
      now: () => new Date('2026-07-25T00:00:00.000Z'),
    });

    await expect(service.dispatchPending()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      retried: 0,
      dead: 0,
      stale: 0,
    });
    expect(cipher.decrypt).toHaveBeenCalledWith({
      ciphertext: delivery.tokenCiphertext,
      keyId: delivery.encryptionKeyId,
    });
    expect(provider.send).toHaveBeenCalledWith({
      platform: 'ios',
      deviceToken: 'native-token-secret',
      title: '生成が完了しました',
      body: 'アプリで結果を確認できます。',
      data: delivery.navigation,
    });
    expect(repository.markSent).toHaveBeenCalledWith(
      delivery.deliveryId,
      delivery.leaseToken,
    );
  });

  it('無効tokenはdeliveryをdeadにして該当tokenだけを削除する', async () => {
    const repository = buildRepository([delivery]);
    const provider = { send: vi.fn().mockResolvedValue({ outcome: 'invalid_token' }) };
    const service = new PushNotificationDeliveryService(
      repository,
      { decrypt: vi.fn().mockResolvedValue('invalid-native-token') },
      provider,
    );

    await expect(service.dispatchPending()).resolves.toMatchObject({ dead: 1 });
    expect(repository.markDead).toHaveBeenCalledWith(
      delivery.deliveryId,
      delivery.leaseToken,
      'invalid_token',
    );
    expect(repository.deletePushToken).toHaveBeenCalledWith(delivery.pushTokenId);
  });

  it('retryable failureだけを端末単位で指数backoffへ戻す', async () => {
    const repository = buildRepository([{ ...delivery, attemptCount: 3 }]);
    const provider = {
      send: vi.fn().mockRejectedValue(
        new PushProviderError('provider_unavailable', true),
      ),
    };
    const now = new Date('2026-07-25T00:00:00.000Z');
    const service = new PushNotificationDeliveryService(
      repository,
      { decrypt: vi.fn().mockResolvedValue('native-token-secret') },
      provider,
      { now: () => now },
    );

    await expect(service.dispatchPending()).resolves.toMatchObject({ retried: 1 });
    expect(repository.markRetry).toHaveBeenCalledWith(
      delivery.deliveryId,
      delivery.leaseToken,
      'provider_unavailable',
      new Date('2026-07-25T00:04:00.000Z'),
    );
    expect(repository.markSent).not.toHaveBeenCalled();
  });

  it('復号失敗とpermanent provider failureは秘密を記録せず再試行しない', async () => {
    const first = { ...delivery };
    const second = {
      ...delivery,
      deliveryId: '77777777-7777-4777-8777-777777777777',
      pushTokenId: '88888888-8888-4888-8888-888888888888',
    };
    const repository = buildRepository([first, second]);
    const cipher = {
      decrypt: vi
        .fn()
        .mockRejectedValueOnce(new Error('ciphertext native-token-secret'))
        .mockResolvedValueOnce('native-token-secret'),
    };
    const provider = {
      send: vi.fn().mockRejectedValue(new PushProviderError('provider_rejected', false)),
    };
    const service = new PushNotificationDeliveryService(repository, cipher, provider);

    await expect(service.dispatchPending()).resolves.toMatchObject({ dead: 2 });
    expect(repository.markDead).toHaveBeenNthCalledWith(
      1,
      first.deliveryId,
      first.leaseToken,
      'token_decryption_failed',
    );
    expect(repository.markDead).toHaveBeenNthCalledWith(
      2,
      second.deliveryId,
      second.leaseToken,
      'provider_rejected',
    );
    expect(JSON.stringify(repository.markDead.mock.calls)).not.toContain('native-token-secret');
  });

  it('leaseを失った無効token応答では現在のtoken登録を削除しない', async () => {
    const repository = buildRepository([delivery]);
    repository.markDead.mockResolvedValue(false);
    const service = new PushNotificationDeliveryService(
      repository,
      { decrypt: vi.fn().mockResolvedValue('invalid-native-token') },
      { send: vi.fn().mockResolvedValue({ outcome: 'invalid_token' }) },
    );

    await expect(service.dispatchPending()).resolves.toMatchObject({ stale: 1 });
    expect(repository.deletePushToken).not.toHaveBeenCalled();
  });
});

function buildRepository(deliveries: typeof delivery[]) {
  return {
    claimPending: vi.fn().mockResolvedValue(deliveries),
    markSent: vi.fn().mockResolvedValue(true),
    markRetry: vi.fn().mockResolvedValue(true),
    markDead: vi.fn().mockResolvedValue(true),
    deletePushToken: vi.fn().mockResolvedValue(undefined),
  };
}
