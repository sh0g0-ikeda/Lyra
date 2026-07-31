import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { ValidationError } from '../../domain/errors/index.js';
import type { AccountIdentityDeletionPort } from '../../services/account/AccountDeletionService.js';
import {
  ACCOUNT_DELETION_AWS_TIMEOUT_MS,
  runAwsCommandWithTimeout,
} from './AwsCommandTimeout.js';

interface CognitoAccountDeletionClient {
  send(
    command: AdminDisableUserCommand | AdminDeleteUserCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<unknown>;
}

export class CognitoAccountIdentityDeletion
implements AccountIdentityDeletionPort {
  public constructor(
    private readonly client: CognitoAccountDeletionClient,
    private readonly userPoolId: string,
    private readonly timeoutMs = ACCOUNT_DELETION_AWS_TIMEOUT_MS,
  ) {
    if (userPoolId.trim().length === 0) {
      throw new Error('Cognito user pool id is required');
    }
  }

  public async disableIdentity(identityId: string): Promise<void> {
    const username = validateIdentityId(identityId);
    try {
      await runAwsCommandWithTimeout(
        'Account identity disable',
        this.timeoutMs,
        (abortSignal) => this.client.send(
          new AdminDisableUserCommand({
            UserPoolId: this.userPoolId,
            Username: username,
          }),
          { abortSignal },
        ),
      );
    } catch (error) {
      if (!isUserNotFound(error)) {
        throw error;
      }
    }
  }

  public async deleteIdentity(identityId: string): Promise<void> {
    const username = validateIdentityId(identityId);
    try {
      await runAwsCommandWithTimeout(
        'Account identity deletion',
        this.timeoutMs,
        (abortSignal) => this.client.send(
          new AdminDeleteUserCommand({
            UserPoolId: this.userPoolId,
            Username: username,
          }),
          { abortSignal },
        ),
      );
    } catch (error) {
      if (!isUserNotFound(error)) {
        throw error;
      }
    }
  }
}

export function createCognitoAccountIdentityDeletion(input: {
  region: string;
  userPoolId: string;
}): CognitoAccountIdentityDeletion {
  return new CognitoAccountIdentityDeletion(
    new CognitoIdentityProviderClient({ region: input.region }),
    input.userPoolId,
  );
}

function validateIdentityId(identityId: string): string {
  const value = identityId.trim();
  if (value.length === 0 || value.length > 128) {
    throw new ValidationError('Account identity is invalid');
  }
  return value;
}

function isUserNotFound(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'UserNotFoundException'
  );
}
