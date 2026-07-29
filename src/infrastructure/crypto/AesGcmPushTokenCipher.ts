import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes
} from 'node:crypto';

import { ConfigurationError } from '../../domain/errors/index.js';
import { PUSH_TOKEN_LIMITS } from '../../domain/pushToken.js';
import type {
  PushTokenCipherPort,
  PushTokenDecryptionInput,
  PushTokenEncryptionResult
} from '../../services/notification/PushTokenCipherPort.js';

const CIPHERTEXT_VERSION = 'v1';
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const KEY_BYTES = 32;
const AUTHENTICATION_CONTEXT = Buffer.from('lyra-mobile-push-token:v1', 'utf8');

export interface AesGcmPushTokenCipherConfig {
  encryptionKeyBase64: string;
  hashKeyBase64: string;
  keyId: string;
}

export class AesGcmPushTokenCipher implements PushTokenCipherPort {
  private readonly encryptionKey: Buffer;
  private readonly hashKey: Buffer;
  private readonly keyId: string;

  public constructor(config: AesGcmPushTokenCipherConfig) {
    this.encryptionKey = decodeKey(config.encryptionKeyBase64, 'encryption');
    this.hashKey = decodeKey(config.hashKeyBase64, 'hash');
    this.keyId = validateKeyId(config.keyId);
  }

  public async encrypt(value: string): Promise<PushTokenEncryptionResult> {
    const iv = randomBytes(AES_GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(AUTHENTICATION_CONTEXT);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final()
    ]);
    const authenticationTag = cipher.getAuthTag();

    return {
      ciphertext: [
        CIPHERTEXT_VERSION,
        iv.toString('base64url'),
        encrypted.toString('base64url'),
        authenticationTag.toString('base64url')
      ].join('.'),
      keyId: this.keyId
    };
  }

  public async decrypt(input: PushTokenDecryptionInput): Promise<string> {
    if (input.keyId !== this.keyId) {
      throw new ConfigurationError('Push token decryption key is unavailable');
    }

    try {
      const [version, ivValue, encryptedValue, authenticationTagValue, extra] =
        input.ciphertext.split('.');
      if (
        version !== CIPHERTEXT_VERSION ||
        ivValue === undefined ||
        encryptedValue === undefined ||
        authenticationTagValue === undefined ||
        extra !== undefined
      ) {
        throw new Error('invalid ciphertext envelope');
      }

      const iv = decodeBase64Url(ivValue);
      const encrypted = decodeBase64Url(encryptedValue);
      const authenticationTag = decodeBase64Url(authenticationTagValue);
      if (iv.length !== AES_GCM_IV_BYTES || authenticationTag.length !== AES_GCM_TAG_BYTES) {
        throw new Error('invalid ciphertext envelope lengths');
      }

      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAAD(AUTHENTICATION_CONTEXT);
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]).toString('utf8');
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new ConfigurationError('Push token decryption failed');
    }
  }

  public async deterministicHash(value: string): Promise<string> {
    return createHmac('sha256', this.hashKey).update(value, 'utf8').digest('hex');
  }
}

function decodeKey(value: string, purpose: string): Buffer {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) {
    throw new ConfigurationError(`Push token ${purpose} key must be canonical base64`);
  }
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length !== KEY_BYTES || decoded.toString('base64') !== normalized) {
    throw new ConfigurationError(`Push token ${purpose} key must decode to 32 bytes`);
  }
  return decoded;
}

function validateKeyId(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > PUSH_TOKEN_LIMITS.ENCRYPTION_KEY_ID_MAX_LENGTH ||
    !/^[A-Za-z0-9._:-]+$/u.test(normalized)
  ) {
    throw new ConfigurationError('Push token encryption key ID is invalid');
  }
  return normalized;
}

function decodeBase64Url(value: string): Buffer {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('invalid base64url');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new Error('non-canonical base64url');
  }
  return decoded;
}
