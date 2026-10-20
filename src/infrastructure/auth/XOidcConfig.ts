import type { Env } from '../../lib/env.js';
import type { XOidcConfig } from '../../domain/auth/XOidcProtocol.js';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { XOidcCryptoConfig } from './XOidcCrypto.js';
import type { XOAuthGatewayConfig } from './XOAuthGateway.js';
import type { JWK } from 'jose';

type XEnvironment = Partial<Pick<Env, 'AUTH_PROVIDER' | 'AWS_REGION' | 'SES_FROM_EMAIL' | 'COGNITO_USER_POOL_ID'
  | 'X_SIGN_IN_ENABLED' | 'X_ANDROID_ENABLED' | 'X_COGNITO_GUARD_REVIEWED' | 'X_OAUTH_CLIENT_ID' | 'X_OAUTH_CLIENT_SECRET'
  | 'X_OIDC_ISSUER' | 'X_OIDC_CLIENT_ID' | 'X_OIDC_CLIENT_SECRET' | 'X_OIDC_COGNITO_DOMAIN'
  | 'X_OIDC_SIGNING_KEY_BASE64' | 'X_OIDC_KEY_ID' | 'X_OIDC_PREVIOUS_PUBLIC_JWKS' | 'X_OIDC_ENCRYPTION_SECRET' | 'X_OIDC_PROOF_SECRET'>>;
export interface ResolvedXOidcConfig {
  service: XOidcConfig; oauth: XOAuthGatewayConfig; crypto: XOidcCryptoConfig;
  region: string; fromEmail: string; userPoolId: string;
}
export function resolveXOidcConfig(env: XEnvironment): ResolvedXOidcConfig | null {
  if (!env.X_SIGN_IN_ENABLED) return null;
  if (env.AUTH_PROVIDER !== 'cognito' || !env.X_COGNITO_GUARD_REVIEWED) throw new ConfigurationError('X sign-in requires Cognito and the reviewed X collision guard');
  const required = (key: keyof XEnvironment): string => {
    const value = env[key];
    if (typeof value !== 'string' || !value.trim()) throw new ConfigurationError(`X sign-in configuration is incomplete: ${key}`);
    return value.trim();
  };
  const issuer = httpsUrl(required('X_OIDC_ISSUER'));
  if (issuer.pathname !== '/api/auth/x') throw new ConfigurationError('X OIDC issuer must use /api/auth/x');
  const cognito = httpsUrl(required('X_OIDC_COGNITO_DOMAIN'));
  if (cognito.pathname !== '/') throw new ConfigurationError('X Cognito domain must not include a path');
  const clientSecret = required('X_OIDC_CLIENT_SECRET'), encryptionSecret = required('X_OIDC_ENCRYPTION_SECRET'), proofSecret = required('X_OIDC_PROOF_SECRET'), oauthSecret = required('X_OAUTH_CLIENT_SECRET');
  if ([clientSecret, encryptionSecret, proofSecret].some(s => s.length < 32) || new Set([clientSecret, encryptionSecret, proofSecret, oauthSecret]).size !== 4) throw new ConfigurationError('X sign-in requires separate strong secrets');
  let previousPublicJwks: JWK[] = [];
  try {
    const parsed: unknown = env.X_OIDC_PREVIOUS_PUBLIC_JWKS ? JSON.parse(env.X_OIDC_PREVIOUS_PUBLIC_JWKS) : [];
    if (!Array.isArray(parsed) || parsed.length > 3 || parsed.some(x => x === null || typeof x !== 'object')) throw new Error('Invalid JWKS');
    previousPublicJwks = parsed as JWK[];
  } catch { throw new ConfigurationError('X previous public keys must be a bounded JSON array'); }
  const issuerValue = issuer.toString();
  const clientId = required('X_OIDC_CLIENT_ID');
  const oauthClientId = required('X_OAUTH_CLIENT_ID');
  if (clientId === oauthClientId) throw new ConfigurationError('X and the OIDC bridge require separate client IDs');
  return {
    service: { issuer: issuerValue, clientId, clientSecret, cognitoRedirectUri: new URL('/oauth2/idpresponse', cognito).toString(), proofSecret, androidEnabled: env.X_ANDROID_ENABLED === true },
    oauth: { clientId: oauthClientId, clientSecret: oauthSecret, redirectUri: `${issuerValue}/callback` },
    crypto: { issuer: issuerValue, clientId, encryptionSecret, privateKeyPem: Buffer.from(required('X_OIDC_SIGNING_KEY_BASE64'), 'base64').toString('utf8'), keyId: required('X_OIDC_KEY_ID'), previousPublicJwks },
    region: required('AWS_REGION'), fromEmail: required('SES_FROM_EMAIL'), userPoolId: required('COGNITO_USER_POOL_ID'),
  };
}
function httpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigurationError('X endpoints require fixed public HTTPS URLs'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu.test(url.hostname)
    || /(?:\.localhost|\.internal|\.local)$/iu.test(url.hostname) || /^\d+(?:\.\d+){3}$/u.test(url.hostname)) throw new ConfigurationError('X endpoints require fixed public HTTPS URLs');
  return url;
}
