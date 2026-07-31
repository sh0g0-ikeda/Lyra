import { describe, expect, it } from 'vitest';
import { detectUiLanguage, t } from '../src/lib/i18n';

describe('mobile i18n', () => {
  it('日本語と英語の同じmessage keyを解決する', () => {
    expect(t('ja', 'login')).toBe('ログイン');
    expect(t('en', 'login')).toBe('Sign in');
  });

  it('端末localeを対応言語へ安全に正規化する', () => {
    expect(detectUiLanguage('ja-JP')).toBe('ja');
    expect(detectUiLanguage('en-US')).toBe('en');
    expect(detectUiLanguage('fr-FR')).toBe('ja');
  });

  it('サポートコードを文言へ埋め込む', () => {
    expect(t('en', 'supportCode', { code: 'MOB-CONFIG-1234' })).toBe(
      'Support code: MOB-CONFIG-1234',
    );
  });
});
