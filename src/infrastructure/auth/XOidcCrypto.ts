import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  type JsonWebKey as NodeJsonWebKey,
} from 'node:crypto';
import { importPKCS8, SignJWT, type JWK } from 'jose';
import type { XOidcCryptoPort, XProfile } from '../../domain/auth/XOidcProtocol.js';
import { ConfigurationError, UnauthorizedError } from '../../domain/errors/index.js';

const ENVELOPE_VERSION = 'v1';
const ENVELOPE_PURPOSE = 'x-oidc-profile';
const ENVELOPE_AAD = Buffer.from('lyra:x-oidc:sealed:v1', 'utf8');
const ENCRYPTION_KEY_CONTEXT = 'lyra:x-oidc:encryption:v1\0';
const MAX_PLAINTEXT_BYTES = 16 * 1024;
const MAX_CIPHERTEXT_CHARACTERS = 32 * 1024;
const ID_TOKEN_LIFETIME_SECONDS = 120;
const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'] as const;

export interface XOidcCryptoConfig {
  issuer: string;
  clientId: string;
  privateKeyPem: string;
  keyId: string;
  previousPublicJwks?: readonly JWK[];
  encryptionSecret: string;
}

interface SealedEnvelope {
  version: 1;
  purpose: typeof ENVELOPE_PURPOSE;
  value: unknown;
}

export class XOidcCrypto implements XOidcCryptoPort {
  public readonly issuer: string;
  public readonly clientId: string;
  private readonly encryptionKey: Buffer;
  private readonly signingKey: ReturnType<typeof importPKCS8>;
  private readonly keyId: string;
  private readonly publicJwks: readonly JWK[];

  public constructor(config: XOidcCryptoConfig) {
    this.issuer = validateIssuer(config.issuer);
    this.clientId = validateBoundedValue(config.clientId, 1, 512, 'X OIDC client ID');
    this.keyId = validateKeyId(config.keyId);
    this.encryptionKey = deriveEncryptionKey(config.encryptionSecret);

    let privateKey: ReturnType<typeof createPrivateKey>;
    try {
      privateKey = createPrivateKey(config.privateKeyPem);
    } catch {
      throw new ConfigurationError('X OIDC signing private key is invalid');
    }
    if (
      privateKey.asymmetricKeyType !== 'rsa'
      || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    ) {
      throw new ConfigurationError('X OIDC signing key must be an RSA key of at least 2048 bits');
    }
    this.signingKey = importPKCS8(config.privateKeyPem, 'RS256');

    const currentPublic = normalizeCurrentPublicJwk(
      createPublicKey(privateKey).export({ format: 'jwk' }) as JWK,
      this.keyId,
    );
    const previous = (config.previousPublicJwks ?? []).map(normalizePreviousPublicJwk);
    const keyIds = new Set([currentPublic.kid]);
    for (const key of previous) {
      if (keyIds.has(key.kid)) {
        throw new ConfigurationError('X OIDC JWKS key IDs must be unique');
      }
      keyIds.add(key.kid);
    }
    this.publicJwks = [currentPublic, ...previous];
  }

  public seal(value: unknown): string {
    if (value === undefined) {
      throw new ConfigurationError('X OIDC encrypted value is invalid');
    }
    const envelope: SealedEnvelope = { version: 1, purpose: ENVELOPE_PURPOSE, value };
    let serialized: string;
    try {
      serialized = JSON.stringify(envelope);
    } catch {
      throw new ConfigurationError('X OIDC encrypted value is invalid');
    }
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_PLAINTEXT_BYTES) {
      throw new ConfigurationError('X OIDC encrypted value is invalid');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(ENVELOPE_AAD);
    const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      ENVELOPE_VERSION,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  public open(ciphertext: string): unknown {
    try {
      if (ciphertext.length < 1 || ciphertext.length > MAX_CIPHERTEXT_CHARACTERS) {
        throw new Error('ciphertext length is invalid');
      }
      const [version, ivValue, encryptedValue, tagValue, extra] = ciphertext.split('.');
      if (
        version !== ENVELOPE_VERSION
        || ivValue === undefined
        || encryptedValue === undefined
        || tagValue === undefined
        || extra !== undefined
      ) {
        throw new Error('ciphertext envelope is invalid');
      }
      const iv = decodeBase64Url(ivValue);
      const encrypted = decodeBase64Url(encryptedValue);
      const tag = decodeBase64Url(tagValue);
      if (iv.length !== 12 || encrypted.length < 1 || encrypted.length > MAX_PLAINTEXT_BYTES || tag.length !== 16) {
        throw new Error('ciphertext envelope length is invalid');
      }
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAAD(ENVELOPE_AAD);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      const envelope: unknown = JSON.parse(plaintext);
      if (
        !isRecord(envelope)
        || envelope.version !== 1
        || envelope.purpose !== ENVELOPE_PURPOSE
        || !('value' in envelope)
      ) {
        throw new Error('encrypted purpose is invalid');
      }
      return envelope.value;
    } catch {
      throw new UnauthorizedError('Encrypted X identity could not be verified');
    }
  }

  public async signIdentity(
    profile: XProfile,
    nonce: string | undefined,
    nowSeconds: number,
  ): Promise<string> {
    try {
      assertProfile(profile);
      if (
        !Number.isSafeInteger(nowSeconds)
        || nowSeconds < 1
        || (nonce !== undefined && (nonce.length < 1 || nonce.length > 512 || /[\u0000-\u001F\u007F]/u.test(nonce)))
      ) {
        throw new Error('identity token input is invalid');
      }
      return await new SignJWT({
        email: profile.email,
        email_verified: true,
        name: profile.name,
        auth_time: nowSeconds,
        ...(nonce === undefined ? {} : { nonce }),
      })
        .setProtectedHeader({ alg: 'RS256', kid: this.keyId, typ: 'JWT' })
        .setIssuer(this.issuer)
        .setAudience(this.clientId)
        .setSubject(profile.subject)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(nowSeconds + ID_TOKEN_LIFETIME_SECONDS)
        .sign(await this.signingKey);
    } catch {
      throw new UnauthorizedError('X identity could not be signed');
    }
  }

  public async jwks(): Promise<{ keys: JWK[] }> {
    return { keys: this.publicJwks.map((key) => ({ ...key })) };
  }
}

function validateIssuer(value: string): string {
  const normalized = validateBoundedValue(value, 1, 2048, 'X OIDC issuer');
  let issuer: URL;
  try {
    issuer = new URL(normalized);
  } catch {
    throw new ConfigurationError('X OIDC issuer is invalid');
  }
  if (
    issuer.protocol !== 'https:'
    || issuer.username.length > 0
    || issuer.password.length > 0
    || issuer.search.length > 0
    || issuer.hash.length > 0
    || normalized.endsWith('/')
  ) {
    throw new ConfigurationError('X OIDC issuer must be an exact HTTPS URL without a trailing slash');
  }
  return normalized;
}

function validateBoundedValue(value: string, minimum: number, maximum: number, label: string): string {
  if (value.trim() !== value || value.length < minimum || value.length > maximum) {
    throw new ConfigurationError(`${label} is invalid`);
  }
  return value;
}

function validateKeyId(value: string): string {
  const keyId = validateBoundedValue(value, 1, 128, 'X OIDC signing key ID');
  if (!/^[A-Za-z0-9._:-]+$/u.test(keyId)) {
    throw new ConfigurationError('X OIDC signing key ID is invalid');
  }
  return keyId;
}

function deriveEncryptionKey(secret: string): Buffer {
  validateBoundedValue(secret, 32, 4096, 'X OIDC encryption secret');
  return createHash('sha256').update(`${ENCRYPTION_KEY_CONTEXT}${secret}`, 'utf8').digest();
}

function normalizeCurrentPublicJwk(value: JWK, keyId: string): JWK {
  if (value.kty !== 'RSA' || typeof value.n !== 'string' || typeof value.e !== 'string') {
    throw new ConfigurationError('X OIDC signing public key is invalid');
  }
  return { kty: 'RSA', n: value.n, e: value.e, kid: keyId, alg: 'RS256', use: 'sig' };
}

function normalizePreviousPublicJwk(value: JWK): JWK {
  if (
    value.kty !== 'RSA'
    || typeof value.n !== 'string'
    || typeof value.e !== 'string'
    || typeof value.kid !== 'string'
    || value.kid.length < 1
    || value.kid.length > 128
    || !/^[A-Za-z0-9._:-]+$/u.test(value.kid)
    || (value.alg !== undefined && value.alg !== 'RS256')
    || (value.use !== undefined && value.use !== 'sig')
    || PRIVATE_JWK_MEMBERS.some((member) => member in value)
  ) {
    throw new ConfigurationError('X OIDC previous JWKS must contain public RS256 signing keys only');
  }
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey({ key: value as NodeJsonWebKey, format: 'jwk' });
  } catch {
    throw new ConfigurationError('X OIDC previous JWKS contains an invalid RSA key');
  }
  if ((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new ConfigurationError('X OIDC previous JWKS RSA keys must be at least 2048 bits');
  }
  return { kty: 'RSA', n: value.n, e: value.e, kid: value.kid, alg: 'RS256', use: 'sig' };
}

function decodeBase64Url(value: string): Buffer {
  if (value.length < 1 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('base64url value is invalid');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new Error('base64url value is not canonical');
  }
  return decoded;
}

function assertProfile(profile: XProfile): void {
  if (
    !/^[1-9][0-9]{0,31}$/u.test(profile.subject)
    || profile.email.length < 3
    || profile.email.length > 320
    || profile.email.trim() !== profile.email
    || profile.email.toLowerCase() !== profile.email
    || !isEmail(profile.email)
    || profile.name.length < 1
    || profile.name.length > 100
    || profile.name.trim() !== profile.name
  ) {
    throw new Error('X identity is invalid');
  }
}

function isEmail(value: string): boolean {
  const at = value.indexOf('@');
  return at > 0
    && at === value.lastIndexOf('@')
    && at < value.length - 3
    && value.slice(at + 1).includes('.')
    && !/\s/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
