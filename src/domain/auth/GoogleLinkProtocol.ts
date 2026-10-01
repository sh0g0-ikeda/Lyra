import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ConfigurationError, UnauthorizedError } from '../errors/index.js';
export interface GoogleLinkMaterial {
    state: string;
    nonce: string;
    verifier: string;
}
export const GOOGLE_LINK_TTL_MS = 10 * 60 * 1000;
export const GOOGLE_LINK_RECENT_AUTH_SECONDS = 300;
export const GOOGLE_LINK_NATIVE_RETURN_URI = 'lyra-mobile://auth/identity-link';
export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_LINK_STATUSES = ['pending', 'processing', 'linked', 'cancelled', 'expired', 'failed', 'recovery_required'] as const;
export type GoogleLinkStatus = typeof GOOGLE_LINK_STATUSES[number];
function encryptionKey(secret: string): Buffer {
    if (secret.length < 32)
        throw new ConfigurationError('Google identity linking encryption is not configured');
    return createHash('sha256').update(`lyra:google-link:v1:${secret}`).digest();
}
export function createGoogleLinkMaterial(): GoogleLinkMaterial {
    return { state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url') };
}
export function googleLinkHash(value: string, secret: string, purpose: string): string {
    return createHmac('sha256', encryptionKey(secret)).update(`lyra:google-link:${purpose}:`).update(value).digest('hex');
}
export function secureHashEquals(left: string, right: string): boolean {
    const a = Buffer.from(left), b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}
export function encryptGoogleLinkMaterial(material: GoogleLinkMaterial, secret: string, challengeId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
    cipher.setAAD(Buffer.from(`google-link:${challengeId}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(material), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}
export function decryptGoogleLinkMaterial(encrypted: string, secret: string, challengeId: string): GoogleLinkMaterial {
    try {
        const [version, ivPart, cipherPart, tagPart, ...extra] = encrypted.split('.');
        if (version !== 'v1' || extra.length !== 0 || !ivPart || !cipherPart || !tagPart)
            throw new Error('invalid');
        for (const part of [ivPart, cipherPart, tagPart])
            if (Buffer.from(part, 'base64url').toString('base64url') !== part)
                throw new Error('invalid');
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivPart, 'base64url'));
        decipher.setAAD(Buffer.from(`google-link:${challengeId}`));
        decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
        const parsed: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(cipherPart, 'base64url')), decipher.final()]).toString('utf8'));
        if (typeof parsed !== 'object' || parsed === null)
            throw new Error('invalid');
        const row = parsed as Record<string, unknown>;
        if (![row.state, row.nonce, row.verifier].every((v) => typeof v === 'string' && /^[A-Za-z0-9_-]{43,128}$/u.test(v)))
            throw new Error('invalid');
        return { state: row.state as string, nonce: row.nonce as string, verifier: row.verifier as string };
    }
    catch {
        throw new UnauthorizedError('Google identity link material is unavailable');
    }
}
export function googleLinkAuthorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    material: GoogleLinkMaterial;
}): string {
    const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    const values = { client_id: input.clientId, redirect_uri: input.redirectUri, response_type: 'code', scope: 'openid email', state: input.material.state, nonce: input.material.nonce, prompt: 'select_account', code_challenge: createHash('sha256').update(input.material.verifier).digest('base64url'), code_challenge_method: 'S256' };
    for (const [key, value] of Object.entries(values))
        url.searchParams.set(key, value);
    return url.toString();
}
