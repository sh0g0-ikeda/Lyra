import { AdminGetUserCommand, AdminLinkProviderForUserCommand, CognitoIdentityProviderClient, type AdminGetUserCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { secureHashEquals } from '../../domain/auth/GoogleLinkProtocol.js';
import { UnauthorizedError } from '../../domain/errors/index.js';
import type { GoogleIdentityLinkGateway, NativeCognitoIdentity } from '../../services/auth/GoogleIdentityLinkService.js';
interface CognitoLinkClient {
    send(command: AdminGetUserCommand | AdminLinkProviderForUserCommand, options: {
        abortSignal: AbortSignal;
    }): Promise<unknown>;
}
export class VerifiedGoogleIdentityLinkGateway implements GoogleIdentityLinkGateway {
    public constructor(private readonly config: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
        userPoolId: string;
    }, private readonly cognito: CognitoLinkClient, private readonly fetcher: typeof fetch = fetch, private readonly jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')), private readonly timeoutMs = 15000) { }
    public async exchangeCode(input: {
        code: string;
        verifier: string;
        nonce: string;
    }): Promise<{
        subject: string;
        email: string;
    }> {
        try {
            const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
                headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
                    code: input.code, code_verifier: input.verifier, redirect_uri: this.config.redirectUri, grant_type: 'authorization_code' }).toString() });
            if (!response.ok)
                throw new Error('Exchange failed');
            const result: unknown = await response.json();
            if (typeof result !== 'object' || result === null || !('id_token' in result) || typeof result.id_token !== 'string')
                throw new Error('Missing proof');
            const { payload } = await jwtVerify(result.id_token, this.jwks, { algorithms: ['RS256'], audience: this.config.clientId, issuer: ['https://accounts.google.com', 'accounts.google.com'], maxTokenAge: '10m', requiredClaims: ['exp', 'iat', 'sub', 'nonce', 'email', 'email_verified'] });
            if (typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 255 || typeof payload.email !== 'string' || payload.email.length > 320
                || payload.email_verified !== true || typeof payload.nonce !== 'string' || !secureHashEquals(payload.nonce, input.nonce)
                || (payload.azp !== undefined && payload.azp !== this.config.clientId))
                throw new Error('Invalid proof');
            return { subject: payload.sub, email: payload.email };
        }
        catch {
            throw new UnauthorizedError('Google identity proof could not be verified');
        }
    }
    public async getNativeIdentity(username: string): Promise<NativeCognitoIdentity> {
        try {
            const output = await this.cognito.send(new AdminGetUserCommand({ UserPoolId: this.config.userPoolId, Username: username }), { abortSignal: AbortSignal.timeout(this.timeoutMs) }) as AdminGetUserCommandOutput;
            const attrs = new Map((output.UserAttributes ?? []).map(a => [a.Name, a.Value]));
            const subject = attrs.get('sub'), email = attrs.get('email');
            if (!subject || !email || attrs.get('email_verified') !== 'true')
                throw new UnauthorizedError('Existing identity could not be verified');
            const googleSubjects: string[] = [];
            const identities = attrs.get('identities');
            if (identities !== undefined) {
                try {
                    const parsed: unknown = JSON.parse(identities);
                    if (!Array.isArray(parsed))
                        throw new Error('Invalid identities');
                    for (const identity of parsed)
                        if (typeof identity === 'object' && identity !== null && identity.providerName === 'Google' && typeof identity.userId === 'string')
                            googleSubjects.push(identity.userId);
                }
                catch {
                    throw new UnauthorizedError('Existing identity could not be verified');
                }
            }
            return { subject, email, enabled: output.Enabled === true, status: output.UserStatus ?? '', googleSubjects };
        }
        catch {
            throw new UnauthorizedError('Existing identity could not be verified');
        }
    }
    public async linkGoogleIdentity(nativeUsername: string, googleSubject: string): Promise<void> {
        // The destination is Cognito's immutable native username, never an email alias
        // or a Google profile. The caller has verified both identities independently.
        await this.cognito.send(new AdminLinkProviderForUserCommand({ UserPoolId: this.config.userPoolId,
            DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: nativeUsername },
            SourceUser: { ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: googleSubject } }), { abortSignal: AbortSignal.timeout(this.timeoutMs) });
    }
}
export function createGoogleIdentityLinkGateway(config: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    userPoolId: string;
    region: string;
}): VerifiedGoogleIdentityLinkGateway {
    return new VerifiedGoogleIdentityLinkGateway(config, new CognitoIdentityProviderClient({ region: config.region, maxAttempts: 1 }));
}
