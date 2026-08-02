import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ExpoAppConfig {
  expo: {
    icon?: string;
    userInterfaceStyle?: string;
    splash?: unknown;
    plugins?: (
      | string
      | [
          string,
          {
            cameraPermission?: boolean;
            image?: string;
            backgroundColor?: string;
            imageWidth?: number;
            microphonePermission?: boolean;
            resizeMode?: string;
          },
        ]
    )[];
    runtimeVersion?: { policy?: string };
    updates?: { fallbackToCacheTimeout?: number; url?: string };
    ios?: {
      buildNumber?: string;
      privacyManifests?: {
        NSPrivacyTracking?: boolean;
        NSPrivacyTrackingDomains?: string[];
        NSPrivacyCollectedDataTypes?: { NSPrivacyCollectedDataType?: string }[];
      };
    };
    android?: {
      versionCode?: number;
      blockedPermissions?: string[];
      adaptiveIcon?: { foregroundImage?: string; backgroundColor?: string };
    };
  };
}

const mobileRoot = resolve(__dirname, '..');
const config = JSON.parse(
  readFileSync(resolve(mobileRoot, 'app.json'), 'utf8'),
) as ExpoAppConfig;
const easConfig = JSON.parse(
  readFileSync(resolve(mobileRoot, 'eas.json'), 'utf8'),
) as {
  cli?: { appVersionSource?: string };
  build?: Record<string, {
    autoIncrement?: boolean;
    channel?: string;
    env?: Record<string, string>;
    ios?: { simulator?: boolean };
  }>;
  submit?: { production?: { android?: { track?: string }; ios?: object } };
};
const storeConfig = JSON.parse(
  readFileSync(resolve(mobileRoot, 'store.config.json'), 'utf8'),
) as {
  configVersion?: number;
  apple?: {
    copyright?: string;
    advisory?: { ageRatingOverride?: string };
    info?: Record<string, {
      title?: string;
      description?: string;
      keywords?: string[];
      privacyPolicyUrl?: string;
      privacyChoicesUrl?: string;
      supportUrl?: string;
    }>;
  };
};
const googlePlayListings = ['listing-en-US.json', 'listing-ja-JP.json'].map((filename) =>
  JSON.parse(readFileSync(resolve(mobileRoot, 'store', 'google-play', filename), 'utf8')) as {
    fullDescription?: string;
    shortDescription?: string;
  }
);

function assertBundledAsset(assetPath: string | undefined): void {
  expect(assetPath).toMatch(/^\.\/assets\//);
  expect(existsSync(resolve(mobileRoot, assetPath ?? ''))).toBe(true);
}

describe('production app metadata', () => {
  it('icon、adaptive icon、splash を Mobile bundle 内の実在 asset に固定する', () => {
    const splashPlugin = config.expo.plugins?.find(
      (plugin): plugin is [
        string,
        {
          image?: string;
          backgroundColor?: string;
          imageWidth?: number;
          resizeMode?: string;
        },
      ] => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
    );

    assertBundledAsset(config.expo.icon);
    assertBundledAsset(config.expo.android?.adaptiveIcon?.foregroundImage);
    expect(config.expo.splash).toBeUndefined();
    assertBundledAsset(splashPlugin?.[1].image);
    expect(splashPlugin?.[1]).toMatchObject({
      backgroundColor: '#0b0b0b',
      imageWidth: 240,
      resizeMode: 'contain',
    });
    expect(config.expo.userInterfaceStyle).toBe('dark');
  });

  it('runtime version と安全な OTA fallback policy を固定する', () => {
    expect(config.expo.runtimeVersion?.policy).toBe('appVersion');
    expect(config.expo.updates?.fallbackToCacheTimeout).toBe(0);
    expect(config.expo.updates?.url).toMatch(/^https:\/\/u\.expo\.dev\//);
    expect(easConfig.cli?.appVersionSource).toBe('remote');
    expect(easConfig.build?.production).toMatchObject({
      autoIncrement: true,
      channel: 'production',
    });
    expect(easConfig.build?.preview).toMatchObject({
      autoIncrement: true,
    });
    expect(easConfig.submit?.production?.android?.track).toBe('internal');
    expect(easConfig.submit?.production?.ios).toBeDefined();
  });

  it('remote version管理を単一ソースにし資格情報不要のiOS simulator buildを定義する', () => {
    expect(config.expo.ios?.buildNumber).toBeUndefined();
    expect(config.expo.android?.versionCode).toBeUndefined();
    expect(easConfig.build?.['ios-simulator']).toMatchObject({
      env: {
        EXPO_PUBLIC_BUILD_ENVIRONMENT: 'preview',
        EXPO_PUBLIC_APP_LINK_HOST: 'app.lyra-editor.com',
        EXPO_PUBLIC_ORGANIZATION_FEATURES_ENABLED: 'true',
        SENTRY_DISABLE_AUTO_UPLOAD: 'true',
      },
      ios: { simulator: true },
    });
  });

  it('development、preview、smoke、productionで法人受入導線を有効にする', () => {
    for (const profile of ['development', 'preview', 'smoke', 'production']) {
      expect(
        easConfig.build?.[profile]?.env?.EXPO_PUBLIC_ORGANIZATION_FEATURES_ENABLED
      ).toBe('true');
    }
  });

  it('Sentry資格情報に依存せず全buildでsource map uploadを無効にする', () => {
    for (const profile of ['development', 'preview', 'ios-simulator', 'smoke', 'production']) {
      expect(easConfig.build?.[profile]?.env?.SENTRY_DISABLE_AUTO_UPLOAD).toBe('true');
    }
  });

  it('未使用のcamera、microphone、overlay、push、legacy storage権限を最終Manifestから除外する', () => {
    const imagePickerPlugin = config.expo.plugins?.find(
      (plugin): plugin is [
        string,
        {
          cameraPermission?: boolean;
          microphonePermission?: boolean;
        },
      ] => Array.isArray(plugin) && plugin[0] === 'expo-image-picker',
    );

    expect(imagePickerPlugin?.[1]).toMatchObject({
      cameraPermission: false,
      microphonePermission: false,
    });
    expect(config.expo.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.CAMERA',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.READ_APP_BADGE',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.RECORD_AUDIO',
        'android.permission.RECEIVE_BOOT_COMPLETED',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE',
        'android.permission.WAKE_LOCK',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'com.anddoes.launcher.permission.UPDATE_COUNT',
        'com.google.android.c2dm.permission.RECEIVE',
        'com.htc.launcher.permission.READ_SETTINGS',
        'com.htc.launcher.permission.UPDATE_SHORTCUT',
        'com.huawei.android.launcher.permission.CHANGE_BADGE',
        'com.huawei.android.launcher.permission.READ_SETTINGS',
        'com.huawei.android.launcher.permission.WRITE_SETTINGS',
        'com.majeur.launcher.permission.UPDATE_BADGE',
        'com.oppo.launcher.permission.READ_SETTINGS',
        'com.oppo.launcher.permission.WRITE_SETTINGS',
        'com.sec.android.provider.badge.permission.READ',
        'com.sec.android.provider.badge.permission.WRITE',
        'com.sonyericsson.home.permission.BROADCAST_BADGE',
        'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
        'me.everything.badger.permission.BADGE_COUNT_READ',
        'me.everything.badger.permission.BADGE_COUNT_WRITE',
      ]),
    );
  });

  it('iOS privacy manifest で tracking 無効を明示する', () => {
    expect(config.expo.ios?.privacyManifests).toMatchObject({
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
    });
    const declaredTypes = config.expo.ios?.privacyManifests?.NSPrivacyCollectedDataTypes
      ?.map((entry) => entry.NSPrivacyCollectedDataType);
    expect(declaredTypes).toEqual(expect.arrayContaining([
      'NSPrivacyCollectedDataTypeEmailAddress',
      'NSPrivacyCollectedDataTypeUserID',
      'NSPrivacyCollectedDataTypeOtherUserContent',
      'NSPrivacyCollectedDataTypePhotosorVideos',
      'NSPrivacyCollectedDataTypePurchaseHistory',
    ]));
  });

  it('日英の store metadata と公開ポリシー URL を固定する', () => {
    expect(storeConfig.configVersion).toBe(0);
    expect(storeConfig.apple?.copyright).toMatch(/^2026 /);
    expect(storeConfig.apple?.advisory?.ageRatingOverride).toBe('SEVENTEEN_PLUS');
    expect(storeConfig.apple?.info?.ja).toMatchObject({
      title: 'Lyra Mobile',
      privacyPolicyUrl: 'https://app.lyra-editor.com/privacy.html',
      privacyChoicesUrl: 'https://app.lyra-editor.com/account-deletion.html',
      supportUrl: 'https://app.lyra-editor.com/support.html',
    });
    expect(storeConfig.apple?.info?.['en-US']).toMatchObject({
      title: 'Lyra Mobile',
      privacyPolicyUrl: 'https://app.lyra-editor.com/privacy-en.html',
      privacyChoicesUrl: 'https://app.lyra-editor.com/account-deletion-en.html',
      supportUrl: 'https://app.lyra-editor.com/support-en.html',
    });
    for (const language of ['ja', 'en-US']) {
      expect(storeConfig.apple?.info?.[language]?.description?.length).toBeGreaterThan(100);
      expect(storeConfig.apple?.info?.[language]?.keywords?.length).toBeGreaterThan(2);
    }
    expect(easConfig.submit?.production?.ios).toMatchObject({
      metadataPath: './store.config.json',
    });
  });

  it('production buildで既存のアカウント削除UIを有効にする', () => {
    expect(
      easConfig.build?.production?.env?.EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED
    ).toBe('true');
  });

  it('previewとproductionのstore buildは登録済みcustom schemeの認証callbackを使う', () => {
    for (const profile of ['preview', 'ios-simulator', 'smoke', 'production']) {
      const environment = easConfig.build?.[profile]?.env;
      expect(environment?.EXPO_PUBLIC_COGNITO_REDIRECT_URI).toBe(
        'lyra-mobile://auth/mobile/callback'
      );
      expect(environment?.EXPO_PUBLIC_COGNITO_LOGOUT_REDIRECT_URI).toBe(
        'lyra-mobile://auth/mobile/logout'
      );
    }
  });

  it('静的設定とストアコピーは未公開のPDF、ZIP、購入を約束しない', () => {
    expect(config.expo.ios).not.toHaveProperty('associatedDomains');
    const descriptions = [
      storeConfig.apple?.info?.ja?.description,
      storeConfig.apple?.info?.['en-US']?.description,
      ...googlePlayListings.flatMap((listing) => [listing.shortDescription, listing.fullDescription]),
    ].filter((description): description is string => description !== undefined);

    for (const description of descriptions) {
      expect(description).not.toMatch(/PDF|ZIP|purchase|購入|課金/u);
    }
    expect(descriptions.join('\n')).toMatch(/generated page images|生成済みページ画像/u);
  });

  it('日英の法務ページと専用削除申請ページをbundleへ含める', () => {
    const webPublic = resolve(mobileRoot, '..', 'web', 'public');
    for (const filename of [
      'privacy.html',
      'privacy-en.html',
      'terms.html',
      'terms-en.html',
      'support.html',
      'support-en.html',
      'account-deletion.html',
      'account-deletion-en.html',
    ]) {
      expect(existsSync(resolve(webPublic, filename)), filename).toBe(true);
    }
    const privacy = readFileSync(resolve(webPublic, 'privacy-en.html'), 'utf8');
    const deletion = readFileSync(resolve(webPublic, 'account-deletion-en.html'), 'utf8');
    expect(privacy).toContain('OpenAI');
    expect(privacy).toContain('Sentry');
    expect(privacy).toContain('international');
    expect(deletion).toContain('mailto:');
    expect(deletion).toContain('Delete your Lyra account');
  });
});
