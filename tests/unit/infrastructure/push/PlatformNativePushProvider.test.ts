import { describe, expect, it, vi } from 'vitest';

import { PlatformNativePushProvider } from '../../../../src/infrastructure/push/PlatformNativePushProvider.js';

const baseMessage = {
  deviceToken: 'native-device-token-0123456789',
  title: 'Generation completed',
  body: 'Open the app.',
  data: {
    job_id: '11111111-1111-4111-8111-111111111111',
    organization_id: null,
    target_tab: 'Story' as const,
    work_id: '22222222-2222-4222-8222-222222222222',
    chapter_id: '33333333-3333-4333-8333-333333333333',
    episode_id: '44444444-4444-4444-8444-444444444444',
  },
};

describe('PlatformNativePushProvider', () => {
  it('iOSはAPNs、AndroidはFCMへだけ委譲する', async () => {
    const apns = { send: vi.fn().mockResolvedValue({ outcome: 'sent' }) };
    const fcm = { send: vi.fn().mockResolvedValue({ outcome: 'sent' }) };
    const provider = new PlatformNativePushProvider(apns, fcm);

    await provider.send({ ...baseMessage, platform: 'ios' });
    await provider.send({ ...baseMessage, platform: 'android' });

    expect(apns.send).toHaveBeenCalledTimes(1);
    expect(apns.send).toHaveBeenCalledWith({ ...baseMessage, platform: 'ios' });
    expect(fcm.send).toHaveBeenCalledTimes(1);
    expect(fcm.send).toHaveBeenCalledWith({ ...baseMessage, platform: 'android' });
  });
});
