import {
  MOBILE_PUSH_LOCALES,
  MOBILE_PUSH_PLATFORMS,
  MOBILE_PUSH_TOKEN_LIMITS,
} from '../../domain/constants/mobilePush.js';
import {
  ConfigurationError,
  ValidationError,
} from '../../domain/errors/index.js';
import type {
  PushTokenRegistrationResult,
  RegisterPushTokenInput,
} from '../../domain/types/mobilePush.js';
import type { PushTokenRepository } from '../../repositories/PushTokenRepository.js';
import type { PushTokenCipherPort } from './PushTokenCipher.js';

export interface PushTokenRegistryServicePort {
  register(
    userId: string,
    input: RegisterPushTokenInput,
  ): Promise<PushTokenRegistrationResult>;
  remove(userId: string, installationId: string): Promise<void>;
}

export class PushTokenRegistryService implements PushTokenRegistryServicePort {
  public constructor(
    private readonly repository: PushTokenRepository,
    private readonly cipher: PushTokenCipherPort,
  ) {}

  public async register(
    userId: string,
    input: RegisterPushTokenInput,
  ): Promise<PushTokenRegistrationResult> {
    assertRegistrationInput(input);
    const [encrypted, tokenHash] = await Promise.all([
      this.cipher.encrypt(input.deviceToken),
      this.cipher.deterministicHash(input.deviceToken),
    ]);
    assertProtectedTokenValues({
      plaintext: input.deviceToken,
      tokenHash,
      tokenCiphertext: encrypted.ciphertext,
      encryptionKeyId: encrypted.keyId,
    });

    const registration = await this.repository.upsertForUser({
      userId,
      installationId: input.installationId,
      platform: input.platform,
      locale: input.locale,
      tokenHash,
      tokenCiphertext: encrypted.ciphertext,
      encryptionKeyId: encrypted.keyId,
    });

    return {
      installationId: registration.installationId,
      platform: registration.platform,
    };
  }

  public async remove(userId: string, installationId: string): Promise<void> {
    await this.repository.deleteForUser(userId, installationId);
  }
}

function assertRegistrationInput(input: RegisterPushTokenInput): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.installationId,
    )
    || !MOBILE_PUSH_PLATFORMS.includes(input.platform)
    || !MOBILE_PUSH_LOCALES.includes(input.locale)
    || input.deviceToken.length < MOBILE_PUSH_TOKEN_LIMITS.DEVICE_TOKEN_MIN_LENGTH
    || input.deviceToken.length > MOBILE_PUSH_TOKEN_LIMITS.DEVICE_TOKEN_MAX_LENGTH
    || !/^\S+$/u.test(input.deviceToken)
  ) {
    throw new ValidationError('Push token registration is invalid');
  }
}

function assertProtectedTokenValues(input: {
  plaintext: string;
  tokenHash: string;
  tokenCiphertext: string;
  encryptionKeyId: string;
}): void {
  if (!/^[0-9a-f]{64}$/u.test(input.tokenHash)) {
    throw new ConfigurationError('Push token hash is invalid');
  }
  if (
    input.tokenCiphertext === input.plaintext
    || input.tokenCiphertext.length < MOBILE_PUSH_TOKEN_LIMITS.TOKEN_CIPHERTEXT_MIN_LENGTH
    || input.tokenCiphertext.length > MOBILE_PUSH_TOKEN_LIMITS.TOKEN_CIPHERTEXT_MAX_LENGTH
    || !/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/u.test(
      input.tokenCiphertext,
    )
  ) {
    throw new ConfigurationError('Push token ciphertext is invalid');
  }
  if (
    input.encryptionKeyId.length === 0
    || input.encryptionKeyId.length > MOBILE_PUSH_TOKEN_LIMITS.ENCRYPTION_KEY_ID_MAX_LENGTH
    || !/^[A-Za-z0-9._:-]+$/u.test(input.encryptionKeyId)
  ) {
    throw new ConfigurationError('Push token encryption key ID is invalid');
  }
}
