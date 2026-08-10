import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeviceUiLanguage, toSupportedUiLanguage } from '@/lib/deviceLanguage';

const mocks = vi.hoisted(() => ({
  getLocales: vi.fn()
}));

vi.mock('expo-localization', () => ({
  getLocales: mocks.getLocales
}));

describe('端末言語の解決', () => {
  beforeEach(() => {
    mocks.getLocales.mockReset();
  });

  it.each([
    ['ja', 'ja'],
    ['ja-JP', 'ja'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
    [null, 'en']
  ] as const)('端末言語 %s を対応言語 %s に正規化する', (language, expected) => {
    expect(toSupportedUiLanguage(language)).toBe(expected);
  });

  it('端末の第一優先ロケールを使用する', () => {
    mocks.getLocales.mockReturnValue([
      { languageCode: 'ja', languageTag: 'ja-JP' },
      { languageCode: 'en', languageTag: 'en-US' }
    ]);

    expect(getDeviceUiLanguage()).toBe('ja');
  });

  it('端末ロケールを取得できない場合は英語にする', () => {
    mocks.getLocales.mockReturnValue([]);

    expect(getDeviceUiLanguage()).toBe('en');
  });
});
