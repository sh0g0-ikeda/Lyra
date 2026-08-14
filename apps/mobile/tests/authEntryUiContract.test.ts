import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { t, type TranslationKey } from '@/lib/i18n';

const authScreenPath = fileURLToPath(
  new URL('../src/screens/AuthScreen.tsx', import.meta.url)
);
const primaryButtonPath = fileURLToPath(
  new URL('../src/components/PrimaryButton.tsx', import.meta.url)
);
const screenPath = fileURLToPath(
  new URL('../src/components/Screen.tsx', import.meta.url)
);
const brandMarkPath = fileURLToPath(
  new URL('../assets/brand-mark.png', import.meta.url)
);

const entryKeys = [
  'screen.auth.brand',
  'screen.auth.headline',
  'screen.auth.summary',
  'screen.auth.feature.story',
  'screen.auth.feature.character',
  'screen.auth.feature.page',
  'screen.auth.action',
  'screen.auth.actionHint',
  'screen.auth.securityNote'
] as const satisfies readonly TranslationKey[];

describe('冒頭の認証画面UI契約', () => {
  it('起動画面では正方形ロゴを切らずに短時間だけ表示する', () => {
    const source = readFileSync(authScreenPath, 'utf8');

    expect(source).toContain("require('../../assets/brand-mark.png')");
    expect(source).toContain('resizeMode="contain"');
    expect(source).not.toContain('resizeMode="cover"');
    expect(source).toContain('}, 900);');
    expect(source).toContain('duration: 180');
  });

  it('日本語と英語で目的・主要機能・認証導線を説明する', () => {
    expect(t('ja', 'screen.auth.headline')).toBe('物語から、漫画の1ページへ。');
    expect(t('ja', 'screen.auth.action')).toBe('ログイン / 新規登録');
    expect(t('en', 'screen.auth.headline')).toBe('From story to a manga page.');
    expect(t('en', 'screen.auth.action')).toBe('Sign in / Create account');

    for (const key of entryKeys) {
      expect(t('ja', key)).toBeTruthy();
      expect(t('en', key)).toBeTruthy();
    }
  });

  it('主要ボタンと画面余白を認証画面専用に拡大できる', () => {
    const authSource = readFileSync(authScreenPath, 'utf8');
    const buttonSource = readFileSync(primaryButtonPath, 'utf8');
    const sharedScreenSource = readFileSync(screenPath, 'utf8');

    expect(authSource).toContain('size="large"');
    expect(authSource).toContain('contentStyle={styles.screenContent}');
    expect(authSource).toContain('importantForAccessibility="no-hide-descendants"');
    expect(authSource).toContain('paddingHorizontal: 20');
    expect(buttonSource).toContain("size?: 'default' | 'large'");
    expect(buttonSource).toContain('minHeight: 58');
    expect(buttonSource).toContain('fontSize: 18');
    expect(sharedScreenSource).toContain('contentStyle?: StyleProp<ViewStyle>');
  });

  it('ブランド画像は正方形の高解像度素材を使用する', () => {
    expect(existsSync(brandMarkPath)).toBe(true);

    const png = readFileSync(brandMarkPath);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(1024);
    expect(png.readUInt32BE(20)).toBe(png.readUInt32BE(16));
  });
});
