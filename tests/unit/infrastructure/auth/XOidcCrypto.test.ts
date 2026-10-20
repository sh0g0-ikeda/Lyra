import {
  createCipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  decodeProtectedHeader,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { XOidcCrypto } from '../../../../src/infrastructure/auth/XOidcCrypto.js';

let privateKeyPem: string;
let previousPublicJwk: JWK;

beforeAll(async () => {
  const current = await generateKeyPair('RS256', { extractable: true });
  privateKeyPem = await exportPKCS8(current.privateKey);
  const previous = await generateKeyPair('RS256', { extractable: true });
  previousPublicJwk = {
    ...await exportJWK(previous.publicKey),
    kid: 'previous-key',
    alg: 'RS256',
    use: 'sig',
  };
});

const baseConfig = () => ({
  issuer: 'https://auth.example.com/auth/x',
  clientId: 'cognito-x-client',
  privateKeyPem,
  keyId: 'current-key',
  previousPublicJwks: [previousPublicJwk],
  encryptionSecret: 'test-encryption-secret-with-at-least-32-characters',
});
const profile = { subject: '2244994945', email: 'owner@example.com', name: 'X Owner' };

function sealEnvelope(secret: string, payload: unknown): string {
  const key = createHash('sha256').update(`lyra:x-oidc:encryption:v1\0${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('lyra:x-oidc:sealed:v1', 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
}

// Spec 4/8: encrypted browser state and signed identity tokens use separate
// purposes; only public, rotation-safe key material is exposed.
describe('X OIDC cryptography', () => {
  it('profile envelope を AES-GCM で往復し平文を露出しない', () => {
    const crypto = new XOidcCrypto(baseConfig());

    const sealed = crypto.seal(profile);

    expect(sealed).not.toContain(profile.email);
    expect(sealed).not.toContain(profile.subject);
    expect(crypto.open(sealed)).toEqual(profile);
    expect(crypto.seal(profile)).not.toBe(sealed);
  });

  it('JSON で表現できない undefined を暗号化しない', () => {
    expect(() => new XOidcCrypto(baseConfig()).seal(undefined))
      .toThrow('X OIDC encrypted value is invalid');
  });

  it.each([
    { version: 2, purpose: 'x-oidc-profile', value: profile },
    { version: 1, purpose: 'access-token', value: profile },
    { version: 1, purpose: 'x-oidc-profile' },
  ])('version または purpose が異なる envelope を拒否する %#', (envelope) => {
    const config = baseConfig();
    const crypto = new XOidcCrypto(config);

    expect(() => crypto.open(sealEnvelope(config.encryptionSecret, envelope)))
      .toThrow('Encrypted X identity could not be verified');
  });

  it('改ざんまたは別 secret の ciphertext を拒否する', () => {
    const crypto = new XOidcCrypto(baseConfig());
    const sealed = crypto.seal(profile);
    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith('a') ? 'b' : 'a'}`;
    const otherCrypto = new XOidcCrypto({ ...baseConfig(), encryptionSecret: 'different-encryption-secret-with-at-least-32-chars' });

    expect(() => crypto.open(tampered)).toThrow('Encrypted X identity could not be verified');
    expect(() => otherCrypto.open(sealed)).toThrow('Encrypted X identity could not be verified');
  });

  it('RS256 ID token に固定 issuer audience nonce と verified email を入れる', async () => {
    const crypto = new XOidcCrypto(baseConfig());
    const token = await crypto.signIdentity(profile, 'cognito-nonce', 1_800_000_000);
    const jwks = await crypto.jwks();
    const currentJwk = jwks.keys.find((key) => key.kid === 'current-key');
    expect(currentJwk).toBeDefined();
    const publicKey = await importJWK(currentJwk!, 'RS256');

    const { payload } = await jwtVerify(token, publicKey, {
      issuer: baseConfig().issuer,
      audience: baseConfig().clientId,
      algorithms: ['RS256'],
      currentDate: new Date(1_800_000_000 * 1000),
    });

    expect(decodeProtectedHeader(token)).toEqual({ alg: 'RS256', kid: 'current-key', typ: 'JWT' });
    expect(payload).toMatchObject({
      iss: baseConfig().issuer,
      aud: baseConfig().clientId,
      sub: profile.subject,
      email: profile.email,
      email_verified: true,
      name: profile.name,
      nonce: 'cognito-nonce',
      auth_time: 1_800_000_000,
      iat: 1_800_000_000,
      exp: 1_800_000_120,
    });
    expect(payload).not.toHaveProperty('scope');
    expect(payload).not.toHaveProperty('access_token');
  });

  it('Cognito が nonce を送らない場合に nonce claim を捏造しない', async () => {
    const crypto = new XOidcCrypto(baseConfig());
    const token = await crypto.signIdentity(profile, undefined, 1_800_000_000);
    const currentJwk = (await crypto.jwks()).keys[0]!;
    const publicKey = await importJWK(currentJwk, 'RS256');

    const { payload } = await jwtVerify(token, publicKey, {
      issuer: baseConfig().issuer,
      audience: baseConfig().clientId,
      algorithms: ['RS256'],
      currentDate: new Date(1_800_000_000 * 1000),
    });
    expect(payload).not.toHaveProperty('nonce');
  });

  it('JWKS は current と previous の公開鍵だけを返す', async () => {
    const crypto = new XOidcCrypto(baseConfig());

    const jwks = await crypto.jwks();

    expect(jwks.keys.map((key) => key.kid)).toEqual(['current-key', 'previous-key']);
    for (const key of jwks.keys) {
      expect(key).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
      for (const privateParameter of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) {
        expect(key).not.toHaveProperty(privateParameter);
      }
    }
    jwks.keys[0]!.kid = 'mutated';
    const freshJwks = await crypto.jwks();
    expect(freshJwks.keys[0]?.kid).toBe('current-key');
  });

  it.each([
    { subject: 'not-numeric', email: profile.email, name: profile.name },
    { subject: profile.subject, email: 'invalid', name: profile.name },
    { subject: profile.subject, email: profile.email, name: '' },
  ])('不完全な identity を署名しない %#', async (invalidProfile) => {
    await expect(new XOidcCrypto(baseConfig()).signIdentity(invalidProfile, 'nonce', 1_800_000_000))
      .rejects.toThrow('X identity could not be signed');
  });

  it('危険な issuer、短い secret、private previous JWK を拒否する', async () => {
    expect(() => new XOidcCrypto({ ...baseConfig(), issuer: 'http://auth.example.com' })).toThrow();
    expect(() => new XOidcCrypto({ ...baseConfig(), encryptionSecret: 'short' })).toThrow();
    expect(() => new XOidcCrypto({
      ...baseConfig(),
      previousPublicJwks: [{ ...previousPublicJwk, d: 'private' }],
    })).toThrow();
    expect(() => new XOidcCrypto({
      ...baseConfig(),
      previousPublicJwks: [{
        kty: 'RSA',
        n: Buffer.alloc(128, 0xff).toString('base64url'),
        e: 'AQAB',
        kid: 'weak-previous-key',
        alg: 'RS256',
        use: 'sig',
      }],
    })).toThrow('at least 2048 bits');
  });
});
