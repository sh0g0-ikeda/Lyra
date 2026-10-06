import { describe, expect, it } from 'vitest';
import { resolveGoogleIdentityLinkConfig } from '../../../../src/infrastructure/auth/GoogleIdentityLinkConfig.js';
const config = { AWS_REGION: 'ap-northeast-1', AUTH_PROVIDER: 'cognito', GOOGLE_SIGN_IN_ENABLED: true, GOOGLE_IDENTITY_LINK_ENABLED: true, COGNITO_USER_POOL_ID: 'pool', COGNITO_CLIENT_ID: 'cognito-client', GOOGLE_COGNITO_IDP_CLIENT_ID: 'cognito-google-idp-client', GOOGLE_LINK_CLIENT_ID: 'google-client', GOOGLE_LINK_CLIENT_SECRET: 'test-only', GOOGLE_LINK_ENCRYPTION_SECRET: 's'.repeat(32), GOOGLE_LINK_REDIRECT_URI: 'https://api.example.com/api/auth/identity-links/google/callback', GOOGLE_LINK_WEB_RETURN_URI: 'https://app.example.com/auth/identity-link', GOOGLE_LINK_MOBILE_RETURN_URI: 'lyra-mobile://auth/identity-link' };
describe('Google identity config', () => {
    it('検証環境の場合に検証APKだけへ戻る固定URIを採用する', () => {
        expect(resolveGoogleIdentityLinkConfig({ ...config, APP_ENV: 'staging', GOOGLE_LINK_MOBILE_RETURN_URI: 'lyra-mobile-staging://auth/identity-link' })?.nativeReturnUri).toBe('lyra-mobile-staging://auth/identity-link');
    });
    it('本番環境の場合に公開アプリ用の固定URIを採用する', () => {
        expect(resolveGoogleIdentityLinkConfig({ ...config, APP_ENV: 'production' })?.nativeReturnUri).toBe('lyra-mobile://auth/identity-link');
    });
    it('連携ONでMobile戻り先が未設定の場合に起動を拒否する', () => {
        expect(() => resolveGoogleIdentityLinkConfig({ ...config, GOOGLE_LINK_MOBILE_RETURN_URI: undefined })).toThrow();
    });
    it.each(['https://evil.example/auth/identity-link', 'lyra-mobile://evil/identity-link', 'lyra-mobile://auth/other', 'lyra-mobile://auth/identity-link?redirect=evil', 'lyra-mobile://auth/identity-link#fragment', 'lyra-mobile://name:password@auth/identity-link'])('任意のMobile戻り先の場合に拒否する %s', (uri) => {
        expect(() => resolveGoogleIdentityLinkConfig({ ...config, GOOGLE_LINK_MOBILE_RETURN_URI: uri })).toThrow();
    });
    it('本番と検証の戻り先が逆の場合に拒否する', () => {
        expect(() => resolveGoogleIdentityLinkConfig({ ...config, APP_ENV: 'staging' })).toThrow();
        expect(() => resolveGoogleIdentityLinkConfig({ ...config, APP_ENV: 'production', GOOGLE_LINK_MOBILE_RETURN_URI: 'lyra-mobile-staging://auth/identity-link' })).toThrow();
    });
    it('default OFF requires no private configuration', () => expect(resolveGoogleIdentityLinkConfig({ AUTH_PROVIDER: 'supabase', GOOGLE_SIGN_IN_ENABLED: false, GOOGLE_IDENTITY_LINK_ENABLED: false })).toBeNull());
    it('requires complete dedicated config before enabling either authentication surface', () => { expect(() => resolveGoogleIdentityLinkConfig({ ...config, GOOGLE_IDENTITY_LINK_ENABLED: false })).toThrow(); expect(() => resolveGoogleIdentityLinkConfig({ ...config, GOOGLE_LINK_CLIENT_SECRET: undefined })).toThrow(); expect(() => resolveGoogleIdentityLinkConfig({ ...config, GOOGLE_LINK_CLIENT_ID: 'cognito-client' })).toThrow(); });
    it.each(['http://api.example.com/api/auth/identity-links/google/callback', 'https://api.example.com/other', 'https://api.example.com/api/auth/identity-links/google/callback?redirect=evil', 'https://name:password@api.example.com/api/auth/identity-links/google/callback'])('rejects an unsafe fixed redirect %s', (uri) => { expect(() => resolveGoogleIdentityLinkConfig({ ...config, GOOGLE_LINK_REDIRECT_URI: uri })).toThrow(); });
    it.each(['https://app.example.com/account', 'https://app.example.com/auth/identity-link?redirect=evil', 'https://app.example.com/auth/identity-link#fragment'])('rejects an unsupported Web return %s', (uri) => { expect(() => resolveGoogleIdentityLinkConfig({ ...config, GOOGLE_LINK_WEB_RETURN_URI: uri })).toThrow(); });
    it('iOS有効化が未審査または専用client未登録の場合に起動を拒否する', () => {
        const ios = { ...config, GOOGLE_IOS_ENABLED: true, GOOGLE_IOS_POLICY_REVIEWED: true, GOOGLE_IOS_COGNITO_CLIENT_ID: 'ios-client', COGNITO_ALLOWED_CLIENT_IDS: 'cognito-client,ios-client' };
        expect(() => resolveGoogleIdentityLinkConfig({ ...ios, GOOGLE_IOS_POLICY_REVIEWED: false })).toThrow();
        expect(() => resolveGoogleIdentityLinkConfig({ ...ios, GOOGLE_IOS_COGNITO_CLIENT_ID: undefined })).toThrow();
        expect(() => resolveGoogleIdentityLinkConfig({ ...ios, GOOGLE_IOS_COGNITO_CLIENT_ID: 'cognito-client' })).toThrow();
        expect(() => resolveGoogleIdentityLinkConfig({ ...ios, COGNITO_ALLOWED_CLIENT_IDS: 'cognito-client' })).toThrow();
        expect(() => resolveGoogleIdentityLinkConfig({ ...ios, GOOGLE_SIGN_IN_ENABLED: false })).toThrow();
        expect(() => resolveGoogleIdentityLinkConfig({ ...ios, GOOGLE_IDENTITY_LINK_ENABLED: false, GOOGLE_SIGN_IN_ENABLED: false })).toThrow();
    });
    it('iOSの専用clientと審査済み設定が揃う場合に有効化を受け付ける', () => {
        expect(resolveGoogleIdentityLinkConfig({ ...config, GOOGLE_IOS_ENABLED: true, GOOGLE_IOS_POLICY_REVIEWED: true, GOOGLE_IOS_COGNITO_CLIENT_ID: 'ios-client', COGNITO_ALLOWED_CLIENT_IDS: ' cognito-client, ios-client ' })?.clientId).toBe('google-client');
    });
    it('accepts exact reviewed HTTPS configuration', () => expect(resolveGoogleIdentityLinkConfig(config)?.clientId).toBe('google-client'));
});
