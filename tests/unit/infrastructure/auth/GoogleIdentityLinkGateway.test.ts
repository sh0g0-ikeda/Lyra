import { describe, expect, it, vi } from 'vitest';
import { AdminDeleteUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { VerifiedGoogleIdentityLinkGateway } from '../../../../src/infrastructure/auth/GoogleIdentityLinkGateway.js';
const config = { clientId: 'link-client', clientSecret: 'test-secret', redirectUri: 'https://api.example.com/callback', userPoolId: 'pool' };
const profile = { username: 'google_SubJECT', subject: 'cognito-source-sub', email: 'owner@example.com', googleSubject: 'SubJECT' };
function output(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { Username: profile.username, Enabled: true, UserStatus: 'EXTERNAL_PROVIDER', UserAttributes: [
        { Name: 'sub', Value: profile.subject }, { Name: 'email', Value: profile.email }, { Name: 'email_verified', Value: 'true' },
        { Name: 'identities', Value: JSON.stringify([{ providerName: 'Google', userId: profile.googleSubject }]) },
    ], ...overrides };
}
function fixture(value: unknown = output()) {
    const send = vi.fn(async (_command: unknown, _options: unknown): Promise<unknown> => value);
    return { send, gateway: new VerifiedGoogleIdentityLinkGateway(config, { send }) };
}
function awsError(name: string): Error { return Object.assign(new Error('private-provider-diagnostic'), { name }); }
// Spec 4: independently verify the unused source and recheck its immutable anchor before deletion.
// Distinguish definite rejection from ambiguous mutation; never retry inside this gateway.
describe('Google 認証プロフィールの安全な退避', () => {
    it('prefix が小文字の場合にも subject を変えずプロフィールを検証する', async () => {
        const { gateway, send } = fixture();
        await expect(gateway.getGoogleProfile(profile.googleSubject)).resolves.toEqual(profile);
        expect(send.mock.calls[0]?.[0]).toBeInstanceOf(AdminGetUserCommand);
        expect((send.mock.calls[0]?.[0] as AdminGetUserCommand).input).toEqual({ UserPoolId: 'pool', Username: 'Google_SubJECT' });
        expect(send.mock.calls[0]?.[1]).toMatchObject({ abortSignal: expect.any(AbortSignal) });
    });
    it.each([{ Username: 'google_subject' }, { Username: 'native-user' }, { Enabled: false }, { UserStatus: 'CONFIRMED' }, { UserAttributes: [] }])('条件が不一致の場合にプロフィールを返さない %j', async (patch) => {
        await expect(fixture(output(patch)).gateway.getGoogleProfile(profile.googleSubject)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
    it.each([
        { identities: [] }, { identities: [{ providerName: 'Google', userId: 'different' }] },
        { identities: [{ providerName: 'Facebook', userId: profile.googleSubject }] },
        { identities: [{ providerName: 'Google', userId: profile.googleSubject }, { providerName: 'Apple', userId: 'other' }] },
        { identities: [{ providerName: 'Google', userId: profile.googleSubject }, { providerName: 'Google', userId: profile.googleSubject }] },
        { identities: 'invalid-json' },
    ])('単独の Google identity を確認できない場合に拒否する %j', async ({ identities }) => {
        const value = output();
        value.UserAttributes = [
            { Name: 'sub', Value: profile.subject }, { Name: 'email', Value: profile.email }, { Name: 'email_verified', Value: 'true' },
            { Name: 'identities', Value: typeof identities === 'string' ? identities : JSON.stringify(identities) },
        ];
        await expect(fixture(value).gateway.getGoogleProfile(profile.googleSubject)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
    it('UserNotFoundException の場合だけ不存在を返す', async () => {
        const f = fixture(); f.send.mockRejectedValue(awsError('UserNotFoundException'));
        await expect(f.gateway.getGoogleProfile(profile.googleSubject)).resolves.toBeNull();
    });
    it.each(['NotAuthorizedException', 'TimeoutError', 'InternalErrorException'])('読取が不明な場合に不存在とみなさず診断を隠す %s', async (name) => {
        const f = fixture(); f.send.mockRejectedValue(awsError(name));
        await expect(f.gateway.getGoogleProfile(profile.googleSubject)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Google profile could not be verified' });
    });
    it('削除直前に同一プロフィールを再読取して返却 username を削除する', async () => {
        const f = fixture(); await f.gateway.deleteGoogleProfile(profile);
        expect(f.send).toHaveBeenCalledTimes(2);
        expect(f.send.mock.calls[0]?.[0]).toBeInstanceOf(AdminGetUserCommand);
        expect(f.send.mock.calls[1]?.[0]).toBeInstanceOf(AdminDeleteUserCommand);
        expect((f.send.mock.calls[1]?.[0] as AdminDeleteUserCommand).input).toEqual({ UserPoolId: 'pool', Username: profile.username });
    });
    it.each([{ subject: 'new-sub' }, { username: 'Google_SubJECT' }, { email: 'changed@example.com' }])('確認済みプロフィールが変わった場合に削除しない %j', async (patch) => {
        const f = fixture();
        await expect(f.gateway.deleteGoogleProfile({ ...profile, ...patch })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(f.send).toHaveBeenCalledTimes(1);
    });
    it('確認済みプロフィールが既に存在しない場合に削除を再送しない', async () => {
        const f = fixture(); f.send.mockRejectedValue(awsError('UserNotFoundException'));
        await expect(f.gateway.deleteGoogleProfile(profile)).resolves.toBeUndefined();
        expect(f.send).toHaveBeenCalledTimes(1);
    });
    it.each(['InvalidParameterException', 'UserNotFoundException', 'NotAuthorizedException'])('連携が確定拒否された場合に安全な判定コードを返す %s', async (name) => {
        const f = fixture(); f.send.mockRejectedValue(awsError(name));
        await expect(f.gateway.linkGoogleIdentity('native-user', profile.googleSubject)).rejects.toMatchObject({ code: 'GOOGLE_LINK_REJECTED', statusCode: 409, message: 'Google identity linking was rejected' });
        expect(f.send).toHaveBeenCalledTimes(1);
    });
    it.each(['TimeoutError', 'InternalErrorException', 'Error'])('連携結果が不明な場合に確定拒否へ変換しない %s', async (name) => {
        const f = fixture(); const error = awsError(name); f.send.mockRejectedValue(error);
        await expect(f.gateway.linkGoogleIdentity('native-user', profile.googleSubject)).rejects.toBe(error);
        expect(f.send).toHaveBeenCalledTimes(1);
    });
    it('メールが未検証の場合にプロフィールを返さない', async () => {
        const value = output();
        value.UserAttributes = [
            { Name: 'sub', Value: profile.subject }, { Name: 'email', Value: profile.email }, { Name: 'email_verified', Value: 'false' },
            { Name: 'identities', Value: JSON.stringify([{ providerName: 'Google', userId: profile.googleSubject }]) },
        ];
        await expect(fixture(value).gateway.getGoogleProfile(profile.googleSubject)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
    it('再読取が失敗した場合に削除を呼ばない', async () => {
        const f = fixture(); f.send.mockRejectedValue(awsError('TimeoutError'));
        await expect(f.gateway.deleteGoogleProfile(profile)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
        expect(f.send).toHaveBeenCalledTimes(1);
    });
    it('削除応答が不明な場合に再送せず安全なエラーを返す', async () => {
        const f = fixture(); f.send.mockResolvedValueOnce(output()).mockRejectedValueOnce(awsError('TimeoutError'));
        await expect(f.gateway.deleteGoogleProfile(profile)).rejects.toMatchObject({ code: 'GOOGLE_PROFILE_DELETE_FAILED', message: 'Google profile removal could not be confirmed' });
        expect(f.send).toHaveBeenCalledTimes(2);
    });
    it('再読取後に対象が消えた場合に不存在として処理を終える', async () => {
        const f = fixture(); f.send.mockResolvedValueOnce(output()).mockRejectedValueOnce(awsError('UserNotFoundException'));
        await expect(f.gateway.deleteGoogleProfile(profile)).resolves.toBeUndefined();
        expect(f.send).toHaveBeenCalledTimes(2);
    });});
