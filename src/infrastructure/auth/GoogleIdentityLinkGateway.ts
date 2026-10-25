import { AdminDeleteUserCommand, AdminGetUserCommand, AdminLinkProviderForUserCommand, CognitoIdentityProviderClient, type AdminGetUserCommandOutput } from '@aws-sdk/client-cognito-identity-provider';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { secureHashEquals } from '../../domain/auth/GoogleLinkProtocol.js';
import { AppError, UnauthorizedError } from '../../domain/errors/index.js';
import type { GoogleCognitoProfile, GoogleIdentityLinkGateway, NativeCognitoIdentity } from '../../services/auth/GoogleIdentityLinkService.js';
interface CognitoLinkClient {
    send(command: AdminGetUserCommand | AdminDeleteUserCommand | AdminLinkProviderForUserCommand, options: {
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
    public async getGoogleProfile(googleSubject: string): Promise<GoogleCognitoProfile | null> {
        try {
            if (googleSubject.length < 1 || googleSubject.length > 255)
                throw new Error('Invalid subject');
            const output = await this.cognito.send(new AdminGetUserCommand({ UserPoolId: this.config.userPoolId,
                Username: `Google_${googleSubject}` }), { abortSignal: AbortSignal.timeout(this.timeoutMs) }) as AdminGetUserCommandOutput;
            const attrs = new Map((output.UserAttributes ?? []).map(attribute => [attribute.Name, attribute.Value]));
            const subject = attrs.get('sub'), email = attrs.get('email'), identities = attrs.get('identities');
            const username = output.Username;
            if (!username || !/^Google_/iu.test(username) || username.slice('Google_'.length) !== googleSubject
                || output.Enabled !== true || output.UserStatus !== 'EXTERNAL_PROVIDER'
                || !subject || subject.length > 256 || !email || email.length > 320 || attrs.get('email_verified') !== 'true' || !identities)
                throw new Error('Invalid Google profile');
            const parsed: unknown = JSON.parse(identities);
            if (!Array.isArray(parsed) || parsed.length !== 1)
                throw new Error('Invalid identities');
            const identity: unknown = parsed[0];
            if (typeof identity !== 'object' || identity === null || !('providerName' in identity) || identity.providerName !== 'Google'
                || !('userId' in identity) || identity.userId !== googleSubject)
                throw new Error('Invalid Google identity');
            return { username, subject, email, googleSubject };
        }
        catch (error) {
            if (hasErrorName(error, 'UserNotFoundException')) return null;
            throw new UnauthorizedError('Google profile could not be verified');
        }
    }
    public async deleteGoogleProfile(profile: GoogleCognitoProfile): Promise<void> {
        // The repository must first durably fence this unused Cognito subject.
        // Revalidate the immutable anchor rather than deleting by an email alias.
        const current = await this.getGoogleProfile(profile.googleSubject);
        if (current === null) return;
        if (current.username !== profile.username || current.subject !== profile.subject || current.email !== profile.email)
            throw new UnauthorizedError('Google profile could not be verified');
        try {
            await this.cognito.send(new AdminDeleteUserCommand({ UserPoolId: this.config.userPoolId,
                Username: current.username }), { abortSignal: AbortSignal.timeout(this.timeoutMs) });
        }
        catch (error) {
            if (hasErrorName(error, 'UserNotFoundException')) return;
            throw new AppError('GOOGLE_PROFILE_DELETE_FAILED', 'Google profile removal could not be confirmed', 503);
        }
    }
    public async linkGoogleIdentity(nativeUsername: string, googleSubject: string): Promise<void> {
        // The destination is Cognito's immutable native username, never an email alias
        // or a Google profile. The caller has verified both identities independently.
        try {
            await this.cognito.send(new AdminLinkProviderForUserCommand({ UserPoolId: this.config.userPoolId,
                DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: nativeUsername },
                SourceUser: { ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: googleSubject } }), { abortSignal: AbortSignal.timeout(this.timeoutMs) });
        }
        catch (error) {
            if (['InvalidParameterException', 'UserNotFoundException', 'NotAuthorizedException'].some(name => hasErrorName(error, name)))
                throw new AppError('GOOGLE_LINK_REJECTED', 'Google identity linking was rejected', 409);
            throw error;
        }
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

function hasErrorName(error: unknown, name: string): boolean {
    return typeof error === 'object' && error !== null && 'name' in error && error.name === name;
}
