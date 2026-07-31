import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
type ExpoPlugin = string | [string, Record<string, unknown>];
const createExpoConfig = require('../app.config.js') as (input: {
  config: {
    name: string;
    ios?: Record<string, unknown>;
    android?: Record<string, unknown>;
    plugins?: ExpoPlugin[];
  };
}) => {
  name: string;
  ios?: Record<string, unknown>;
  android?: Record<string, unknown>;
  plugins?: ExpoPlugin[];
};

describe('Expo app config', () => {
  it('Store、Push、universal linkのnative設定を追加しない', () => {
    const config = createExpoConfig({
      config: {
        name: 'Lyra Mobile',
        ios: {
          associatedDomains: ['applinks:app.lyra-editor.com'],
          bundleIdentifier: 'com.lyra.mobile'
        },
        android: {
          googleServicesFile: '/eas/secrets/google-services.json',
          intentFilters: [{ action: 'VIEW' }],
          package: 'com.lyra.mobile'
        },
        plugins: ['expo-secure-store'],
      }
    });

    expect(config).toMatchObject({ name: 'Lyra Mobile' });
    expect(config.ios).not.toHaveProperty('associatedDomains');
    expect(config.ios).not.toHaveProperty('bundleIdentifier');
    expect(config.android).not.toHaveProperty('googleServicesFile');
    expect(config.android).not.toHaveProperty('intentFilters');
    expect(config.android).not.toHaveProperty('package');
    expect(config.plugins).toEqual([
      'expo-secure-store',
      'expo-image',
      ['expo-image-picker', {
        cameraPermission: false,
        microphonePermission: false,
        photosPermission: 'Lyraがキャラ参照画像として選んだ写真を読み取ることを許可してください。',
      }],
    ]);
  });

  it('画像pluginの既存設定を保持して重複登録しない', () => {
    const config = createExpoConfig({
      config: {
        name: 'Lyra Mobile',
        plugins: [
          'expo-image',
          ['expo-image-picker', { photosPermission: '既存の説明' }],
        ],
      },
    });

    expect(config.plugins).toEqual([
      'expo-image',
      ['expo-image-picker', { photosPermission: '既存の説明' }],
    ]);
  });
});
