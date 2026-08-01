import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type {
  PushTokenRegistrationPayload
} from '@/domain/payloads';
import type {
  PushTokenRegistrationRecord,
  UiLanguage
} from '@/domain/types';
import {
  loadPushInstallationId,
  savePushInstallationId
} from '@/lib/storage';

const PUSH_CHANNEL_ID = 'job-status';

export interface PushTokenApi {
  registerPushToken(
    payload: PushTokenRegistrationPayload
  ): Promise<PushTokenRegistrationRecord>;
  removePushToken(installationId: string): Promise<void>;
}

export interface PushNotificationRegistration {
  installationId: string;
  removeTokenListener: () => void;
}

export async function registerPushNotifications(
  api: PushTokenApi,
  locale: UiLanguage
): Promise<PushNotificationRegistration | null> {
  const platform = nativePushPlatform();
  if (!Device.isDevice || platform === null) {
    return null;
  }

  if (platform === 'android') {
    await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
      name: 'Lyra generation status',
      importance: Notifications.AndroidImportance.DEFAULT
    });
  }

  const existingPermissions = await Notifications.getPermissionsAsync();
  const permissions = existingPermissions.granted
    ? existingPermissions
    : await Notifications.requestPermissionsAsync();
  if (!permissions.granted) {
    return null;
  }

  const token = await Notifications.getDevicePushTokenAsync();
  if (typeof token.data !== 'string' || token.data.trim().length === 0) {
    return null;
  }

  const installationId = await getOrCreateInstallationId();
  await api.registerPushToken({
    installation_id: installationId,
    platform,
    device_token: token.data,
    locale
  });

  const tokenSubscription = Notifications.addPushTokenListener((nextToken) => {
    if (typeof nextToken.data !== 'string' || nextToken.data.trim().length === 0) {
      return;
    }
    void api
      .registerPushToken({
        installation_id: installationId,
        platform,
        device_token: nextToken.data,
        locale
      })
      .catch(() => undefined);
  });

  return {
    installationId,
    removeTokenListener: () => tokenSubscription.remove()
  };
}

export async function unregisterPushNotifications(api: PushTokenApi): Promise<void> {
  const installationId = await loadPushInstallationId();
  if (installationId !== null) {
    try {
      await api.removePushToken(installationId);
    } catch {
      // Native invalidation below is still required during an offline logout.
    }
  }
  await unregisterNativePushNotifications();
}

export async function unregisterNativePushNotifications(): Promise<void> {
  try {
    await Notifications.unregisterForNotificationsAsync();
  } catch {
    // Logout and fatal-auth cleanup must continue even when the OS service fails.
  }
}

async function getOrCreateInstallationId(): Promise<string> {
  const stored = await loadPushInstallationId();
  if (stored !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(stored)) {
    return stored;
  }
  const created = Crypto.randomUUID();
  await savePushInstallationId(created);
  return created;
}

function nativePushPlatform(): 'ios' | 'android' | null {
  if (Platform.OS === 'ios') {
    return 'ios';
  }
  if (Platform.OS === 'android') {
    return 'android';
  }
  return null;
}
