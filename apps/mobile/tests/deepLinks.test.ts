import { describe, expect, it } from 'vitest';

import { parseMobileLink } from '@/lib/deepLinks';

describe('parseMobileLink', () => {
  it('custom schemeの認証callbackを認識する', () => {
    expect(parseMobileLink('lyra-mobile://auth/callback?code=abc')).toEqual({
      type: 'auth-callback'
    });
  });

  it('custom schemeのログアウトcallbackを認識する', () => {
    expect(parseMobileLink('lyra-mobile://auth/logout')).toEqual({
      type: 'auth-logout'
    });
  });

  it('似たscheme、host、pathとHTTPS universal linkを拒否する', () => {
    expect(parseMobileLink('lyra-mobile://evil/callback')).toBeNull();
    expect(parseMobileLink('lyra-mobile://auth/callback/extra')).toBeNull();
    expect(parseMobileLink('https://app.lyra-editor.com/auth/mobile/callback')).toBeNull();
  });
});
