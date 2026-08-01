import { beforeEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable import/first -- native modules must be mocked before loading the module under test */

const mocks = vi.hoisted(() => ({
  channel: vi.fn().mockResolvedValue(undefined),
  getDeviceToken: vi.fn().mockResolvedValue({ data: 'native-device-token-1234567890', type: 'fcm' }),
  getPermissions: vi.fn().mockResolvedValue({ granted: true }),
  isDevice: true,
  loadInstallationId: vi.fn().mockResolvedValue(null),
  platform: 'android',
  requestPermissions: vi.fn().mockResolvedValue({ granted: true }),
  saveInstallationId: vi.fn().mockResolvedValue(undefined),
  tokenListener: vi.fn(() => ({ remove: vi.fn() })),
  unregister: vi.fn().mockResolvedValue(undefined),
  uuid: vi.fn(() => '11111111-1111-4111-8111-111111111111')
}));

vi.mock('expo-device', () => ({
  get isDevice() {
    return mocks.isDevice;
  }
}));
vi.mock('expo-crypto', () => ({ randomUUID: mocks.uuid }));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  addPushTokenListener: mocks.tokenListener,
  getDevicePushTokenAsync: mocks.getDeviceToken,
  getPermissionsAsync: mocks.getPermissions,
  requestPermissionsAsync: mocks.requestPermissions,
  setNotificationChannelAsync: mocks.channel,
  unregisterForNotificationsAsync: mocks.unregister
}));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    }
  }
}));
vi.mock('@/lib/storage', () => ({
  loadPushInstallationId: mocks.loadInstallationId,
  savePushInstallationId: mocks.saveInstallationId
}));

import {
  registerPushNotifications,
  unregisterPushNotifications
} from '@/lib/pushNotifications';

describe('push notification registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDevice = true;
    mocks.platform = 'android';
    mocks.getPermissions.mockResolvedValue({ granted: true });
    mocks.requestPermissions.mockResolvedValue({ granted: true });
    mocks.getDeviceToken.mockResolvedValue({
      data: 'native-device-token-1234567890',
      type: 'fcm'
    });
    mocks.loadInstallationId.mockResolvedValue(null);
  });

  it('Android channelを先に作り、永続installation IDでnative tokenを登録する', async () => {
    const api = {
      registerPushToken: vi.fn().mockResolvedValue({
        installation_id: '11111111-1111-4111-8111-111111111111',
        platform: 'android',
        status: 'registered'
      }),
      removePushToken: vi.fn()
    };

    await expect(registerPushNotifications(api, 'ja')).resolves.not.toBeNull();

    expect(mocks.channel).toHaveBeenCalledBefore(mocks.getDeviceToken);
    expect(mocks.saveInstallationId).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(api.registerPushToken).toHaveBeenCalledWith({
      installation_id: '11111111-1111-4111-8111-111111111111',
      platform: 'android',
      device_token: 'native-device-token-1234567890',
      locale: 'ja'
    });
  });

  it('権限拒否や実機でない場合はtokenを取得しない', async () => {
    const api = {
      registerPushToken: vi.fn(),
      removePushToken: vi.fn()
    };
    mocks.getPermissions.mockResolvedValue({ granted: false });
    mocks.requestPermissions.mockResolvedValue({ granted: false });

    await expect(registerPushNotifications(api, 'ja')).resolves.toBeNull();
    expect(mocks.getDeviceToken).not.toHaveBeenCalled();

    mocks.isDevice = false;
    await expect(registerPushNotifications(api, 'ja')).resolves.toBeNull();
  });

  it('Backend削除が失敗しても端末tokenを無効化する', async () => {
    mocks.loadInstallationId.mockResolvedValue('11111111-1111-4111-8111-111111111111');
    const api = {
      registerPushToken: vi.fn(),
      removePushToken: vi.fn().mockRejectedValue(new Error('offline'))
    };

    await expect(unregisterPushNotifications(api)).resolves.toBeUndefined();
    expect(api.removePushToken).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(mocks.unregister).toHaveBeenCalledOnce();
  });
});
