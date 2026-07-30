export const MOBILE_PUSH_PLATFORMS = ['ios', 'android'] as const;
export const MOBILE_PUSH_LOCALES = ['ja', 'en'] as const;
export const MOBILE_PUSH_TOKEN_REGISTRY_LOCK_KEY = 'mobile-push-token-registry:v1';

export const MOBILE_PUSH_TOKEN_LIMITS = {
  DEVICE_TOKEN_MIN_LENGTH: 16,
  DEVICE_TOKEN_MAX_LENGTH: 4_096,
  TOKEN_CIPHERTEXT_MIN_LENGTH: 64,
  TOKEN_CIPHERTEXT_MAX_LENGTH: 16_384,
  ENCRYPTION_KEY_ID_MAX_LENGTH: 64,
} as const;

export type MobilePushPlatform = (typeof MOBILE_PUSH_PLATFORMS)[number];
export type MobilePushLocale = (typeof MOBILE_PUSH_LOCALES)[number];
