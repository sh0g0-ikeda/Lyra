import { ConfigurationError } from '../../domain/errors/index.js';
import {
  PUSH_TOKEN_LIMITS,
  type RegisterPushTokenInput,
  type PushTokenRegistrationResult,
} from '../../domain/pushToken.js';
import type { PushTokenRepository } from '../../repositories/PushTokenRepository.js';
import type { PushTokenCipherPort } from './PushTokenCipherPort.js';

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
    const [encrypted, tokenHash] = await Promise.all([
      this.cipher.encrypt(input.deviceToken),
      this.cipher.deterministicHash(input.deviceToken),
    ]);

    assertProtectedValue(
      encrypted.ciphertext,
      'ciphertext',
      PUSH_TOKEN_LIMITS.TOKEN_CIPHERTEXT_MIN_LENGTH,
      PUSH_TOKEN_LIMITS.TOKEN_CIPHERTEXT_MAX_LENGTH,
      input.deviceToken,
    );
    assertProtectedValue(
      tokenHash,
      'token hash',
      PUSH_TOKEN_LIMITS.TOKEN_HASH_MIN_LENGTH,
      PUSH_TOKEN_LIMITS.TOKEN_HASH_MAX_LENGTH,
      input.deviceToken,
    );
    assertProtectedValue(
      encrypted.keyId,
      'encryption key ID',
      1,
      PUSH_TOKEN_LIMITS.ENCRYPTION_KEY_ID_MAX_LENGTH,
      input.deviceToken,
    );

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

function assertProtectedValue(
  value: string,
  field: string,
  minLength: number,
  maxLength: number,
  plaintext: string,
): void {
  if (
    value.length < minLength ||
    value.length > maxLength ||
    value === plaintext
  ) {
    throw new ConfigurationError(`Push token ${field} is invalid`);
  }
}
