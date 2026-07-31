import { createHmac } from 'node:crypto';
import { ConfigurationError, ValidationError } from './errors/index.js';

const ACCOUNT_DELETION_SECRET_MIN_LENGTH = 32;
const ACCOUNT_DELETION_IDENTITY_MAX_LENGTH = 128;

export function validateAccountDeletionIdentitySecret(secret: string): void {
  if (secret.length < ACCOUNT_DELETION_SECRET_MIN_LENGTH) {
    throw new ConfigurationError(
      'Account deletion identity secret must be at least 32 characters',
    );
  }
}

export function createAccountDeletionIdentityKey(
  secret: string,
  identityId: string,
): string {
  validateAccountDeletionIdentitySecret(secret);
  const normalizedIdentityId = identityId.trim();
  if (
    normalizedIdentityId.length === 0
    || normalizedIdentityId.length > ACCOUNT_DELETION_IDENTITY_MAX_LENGTH
  ) {
    throw new ValidationError('Account deletion identity is invalid');
  }

  return createHmac('sha256', secret)
    .update('lyra:account-deletion-identity:v1\0', 'utf8')
    .update(normalizedIdentityId, 'utf8')
    .digest('base64url');
}
