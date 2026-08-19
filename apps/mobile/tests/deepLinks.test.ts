import { describe, expect, it } from 'vitest';

import { parseMobileLink } from '@/lib/deepLinks';

describe('parseMobileLink', () => {
  it('固定HTTPS originの招待リンクからtokenを取得する', () => {
    expect(
      parseMobileLink('https://app.lyra-editor.com/invitations/token-123')
    ).toEqual({ type: 'invitation', token: 'token-123' });
  });

  it('固定HTTPS originの認証callbackを認識する', () => {
    expect(
      parseMobileLink('https://app.lyra-editor.com/auth/mobile/callback?code=abc')
    ).toEqual({ type: 'auth-callback' });
  });

  it('development用custom schemeの認証callbackを認識する', () => {
    expect(parseMobileLink('lyra-mobile://auth/callback?code=abc')).toEqual({
      type: 'auth-callback'
    });
  });

  it('HTTPSとcustom schemeのログアウトcallbackを認識する', () => {
    expect(parseMobileLink('https://app.lyra-editor.com/auth/mobile/logout')).toEqual({
      type: 'auth-logout'
    });
    expect(parseMobileLink('lyra-mobile://auth/logout')).toEqual({
      type: 'auth-logout'
    });
  });

  it('HTTPS用pathを含むhybrid custom scheme認証リンクを拒否する', () => {
    expect(parseMobileLink('lyra-mobile://auth/mobile/callback?code=abc')).toBeNull();
    expect(parseMobileLink('lyra-mobile://auth/mobile/logout')).toBeNull();
  });

  it('見た目が似た外部hostのリンクを拒否する', () => {
    expect(
      parseMobileLink('https://app.lyra-editor.com.evil.example/invitations/token-123')
    ).toBeNull();
  });

  it('空または長すぎる招待tokenを拒否する', () => {
    expect(parseMobileLink('https://app.lyra-editor.com/invitations/')).toBeNull();
    expect(
      parseMobileLink(
        `https://app.lyra-editor.com/invitations/${'a'.repeat(2049)}`
      )
    ).toBeNull();
  });
});
