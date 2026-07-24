export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

export const PUSH_TOKEN_LIMITS = {
  DEVICE_TOKEN_MIN_LENGTH: 16,
  DEVICE_TOKEN_MAX_LENGTH: 4096,
  TOKEN_HASH_MIN_LENGTH: 32,
  TOKEN_HASH_MAX_LENGTH: 256,
  TOKEN_CIPHERTEXT_MIN_LENGTH: 16,
  TOKEN_CIPHERTEXT_MAX_LENGTH: 16_384,
  ENCRYPTION_KEY_ID_MAX_LENGTH: 256,
} as const;

export interface PushTokenRegistration {
  userId: string;
  installationId: string;
  platform: PushPlatform;
  locale: 'ja' | 'en';
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterPushTokenInput {
  installationId: string;
  platform: PushPlatform;
  deviceToken: string;
  locale: 'ja' | 'en';
}

export interface PushTokenRegistrationResult {
  installationId: string;
  platform: PushPlatform;
}
