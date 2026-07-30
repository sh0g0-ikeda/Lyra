import type {
  MobilePushLocale,
  MobilePushPlatform,
} from '../constants/mobilePush.js';

export interface PushTokenRegistration {
  userId: string;
  installationId: string;
  platform: MobilePushPlatform;
  locale: MobilePushLocale;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterPushTokenInput {
  installationId: string;
  platform: MobilePushPlatform;
  locale: MobilePushLocale;
  deviceToken: string;
}

export interface PushTokenRegistrationResult {
  installationId: string;
  platform: MobilePushPlatform;
}
