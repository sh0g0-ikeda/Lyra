import { ConfigurationError } from '../../domain/errors/index.js';
import type { GoogleLinkConfig } from '../../services/auth/GoogleIdentityLinkService.js';
export interface GoogleAuthEnvironment {
    AWS_REGION?: string;
    AUTH_PROVIDER: string;
    GOOGLE_SIGN_IN_ENABLED: boolean;
    GOOGLE_IDENTITY_LINK_ENABLED: boolean;
    GOOGLE_COGNITO_IDP_CLIENT_ID?: string;
    GOOGLE_LINK_CLIENT_ID?: string;
    GOOGLE_LINK_CLIENT_SECRET?: string;
    GOOGLE_LINK_REDIRECT_URI?: string;
    GOOGLE_LINK_WEB_RETURN_URI?: string;
    GOOGLE_LINK_ENCRYPTION_SECRET?: string;
    COGNITO_USER_POOL_ID?: string;
    COGNITO_CLIENT_ID?: string;
    COGNITO_ALLOWED_CLIENT_IDS?: string;
}
export function resolveGoogleIdentityLinkConfig(env: GoogleAuthEnvironment): GoogleLinkConfig | null {
    if (!env.GOOGLE_IDENTITY_LINK_ENABLED) {
        if (env.GOOGLE_SIGN_IN_ENABLED)
            throw new ConfigurationError('Google sign-in requires reviewed identity-link and collision-guard configuration');
        return null;
    }
    if (!env.AWS_REGION || env.AUTH_PROVIDER !== 'cognito' || !env.COGNITO_USER_POOL_ID || !env.GOOGLE_COGNITO_IDP_CLIENT_ID || !env.GOOGLE_LINK_CLIENT_ID || !env.GOOGLE_LINK_CLIENT_SECRET
        || !env.GOOGLE_LINK_REDIRECT_URI || !env.GOOGLE_LINK_WEB_RETURN_URI || !env.GOOGLE_LINK_ENCRYPTION_SECRET || env.GOOGLE_LINK_ENCRYPTION_SECRET.length < 32)
        throw new ConfigurationError('Google identity linking configuration is incomplete');
    const redirect = secureUrl(env.GOOGLE_LINK_REDIRECT_URI), webReturn = secureUrl(env.GOOGLE_LINK_WEB_RETURN_URI);
    if (redirect.pathname !== '/api/auth/identity-links/google/callback')
        throw new ConfigurationError('Google identity linking callback path is invalid');
    if (webReturn.pathname !== '/auth/identity-link')
        throw new ConfigurationError('Google identity linking Web return path is invalid');
    if ([env.GOOGLE_COGNITO_IDP_CLIENT_ID, env.COGNITO_CLIENT_ID, ...(env.COGNITO_ALLOWED_CLIENT_IDS ?? '').split(',')].includes(env.GOOGLE_LINK_CLIENT_ID))
        throw new ConfigurationError('Google identity linking requires a dedicated OAuth client');
    return { clientId: env.GOOGLE_LINK_CLIENT_ID, redirectUri: redirect.toString(), webReturnUri: webReturn.toString(), encryptionSecret: env.GOOGLE_LINK_ENCRYPTION_SECRET };
}
function secureUrl(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname === 'localhost')
        throw new ConfigurationError('Google identity linking redirects require fixed HTTPS endpoints');
    return url;
}
