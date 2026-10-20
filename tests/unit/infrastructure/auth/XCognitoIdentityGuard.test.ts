import { describe, expect, it, vi } from 'vitest';
import { assertXCognitoProfileAllowed, guardXPreSignUp } from '../../../../src/infrastructure/auth/XCognitoIdentityGuard.js';
const profile = { subject: '1234567', email: 'x@example.com', name: 'X user' };
describe('X登録の既存アカウント保護', () => {
  it.each(['CONFIRMED', 'EXTERNAL_PROVIDER'])('同じメールの別プロフィールがある場合に%sでも拒否する', async status => {
    const send = vi.fn().mockResolvedValue({ Users: [{ Username: 'other', UserStatus: status, Attributes: [{ Name: 'email', Value: 'X@example.com' }] }] });
    await expect(assertXCognitoProfileAllowed({ send }, 'pool', profile)).rejects.toMatchObject({ code: 'ACCOUNT_LINK_REQUIRED' });
  });
  it('同一X識別子の既存プロフィールだけの場合に再ログインを許可する', async () => {
    const send = vi.fn().mockResolvedValue({ Users: [{ Username: 'x_1234567', Attributes: [{ Name: 'email', Value: 'x@example.com' }, { Name: 'identities', Value: JSON.stringify([{ providerName: 'X', userId: profile.subject }]) }] }] });
    await expect(assertXCognitoProfileAllowed({ send }, 'pool', profile)).resolves.toBeUndefined();
  });
  it('事前登録トリガーで別方式のメール衝突を拒否しGoogleイベントを変更しない', async () => {
    const event = { triggerSource: 'PreSignUp_ExternalProvider', userPoolId: 'pool', userName: 'x_1234567', request: { userAttributes: { email: profile.email, email_verified: 'true' } }, response: {} };
    await expect(guardXPreSignUp(event, async () => true)).rejects.toMatchObject({ code: 'ACCOUNT_LINK_REQUIRED' });
    const google = { ...event, userName: 'Google_other' };
    expect(await guardXPreSignUp(google, async () => true)).toBe(google);
  });
  it('検索失敗や未検証メールの場合に登録を許可しない', async () => {
    const send = vi.fn().mockRejectedValue(new Error('private AWS request'));
    await expect(assertXCognitoProfileAllowed({ send }, 'pool', profile)).rejects.toThrow('Provider identity is unavailable');
    await expect(guardXPreSignUp({ triggerSource: 'PreSignUp_ExternalProvider', userPoolId: 'pool', userName: 'X_1', request: { userAttributes: { email: profile.email } }, response: {} }, async () => false)).rejects.toThrow('Provider identity is unavailable');
  });
});
