import { describe, expect, it } from 'vitest';
import { resolveXOidcConfig } from '../../../../src/infrastructure/auth/XOidcConfig.js';
describe('X認証の設定', () => {
  it('明示有効化していない場合に外部認証の設定を要求しない', () => {
    expect(resolveXOidcConfig({ X_SIGN_IN_ENABLED: false })).toBeNull();
  });
  it('一部だけ設定した場合に起動時に拒否する', () => {
    expect(() => resolveXOidcConfig({ X_SIGN_IN_ENABLED: true })).toThrow('X');
  });
});
