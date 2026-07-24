import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { ConfigurationError } from '../../domain/errors/index.js';
import type { AccountIdentityDeletionPort } from '../../services/account/AccountDeletionService.js';
import { toSanitizedAwsErrorMessage } from './AwsErrorMessage.js';

const DEFAULT_COGNITO_ADMIN_TIMEOUT_MS = 30_000;
const MAX_COGNITO_SUBJECT_LENGTH = 128;

type CognitoAccountDeletionCommand = AdminDisableUserCommand | AdminDeleteUserCommand;

interface CognitoRequestOptions {
  abortSignal?: AbortSignal;
}

export interface CognitoAccountDeletionClient {
  send(command: CognitoAccountDeletionCommand, options?: CognitoRequestOptions): Promise<unknown>;
}

export interface CognitoAccountIdentityDeletionOptions {
  userPoolId: string;
  timeoutMs?: number;
}

export class CognitoAccountIdentityDeletion implements AccountIdentityDeletionPort {
  private readonly timeoutMs: number;
  private readonly userPoolId: string;

  public constructor(
    private readonly client: CognitoAccountDeletionClient,
    options: CognitoAccountIdentityDeletionOptions,
  ) {
    this.userPoolId = options.userPoolId.trim();
    if (this.userPoolId.length === 0) {
      throw new ConfigurationError('Cognito user pool id is required');
    }
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
  }

  public async disableIdentity(subject: string): Promise<void> {
    this.assertSubject(subject);
    await this.execute(
      new AdminDisableUserCommand({
        UserPoolId: this.userPoolId,
        Username: subject,
      }),
      subject,
      'Failed to disable account identity',
    );
  }

  public async deleteIdentity(subject: string): Promise<void> {
    this.assertSubject(subject);
    await this.execute(
      new AdminDeleteUserCommand({
        UserPoolId: this.userPoolId,
        Username: subject,
      }),
      subject,
      'Failed to delete account identity',
    );
  }

  private async execute(
    command: CognitoAccountDeletionCommand,
    subject: string,
    fallbackMessage: string,
  ): Promise<void> {
    try {
      await this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      if (isCognitoUserNotFound(error)) {
        return;
      }
      throw new ConfigurationError(
        toSanitizedIdentifierSafeAwsErrorMessage(error, fallbackMessage, [subject, this.userPoolId]),
      );
    }
  }

  private assertSubject(subject: string): void {
    if (subject.trim().length === 0) {
      throw new ConfigurationError('Cognito identity subject is required');
    }
    if (subject.trim() !== subject || subject.length > MAX_COGNITO_SUBJECT_LENGTH) {
      throw new ConfigurationError('Cognito identity subject is invalid');
    }
  }
}

export function createCognitoAccountIdentityDeletionClient(region?: string): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient(region === undefined ? {} : { region });
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  const resolved = timeoutMs ?? DEFAULT_COGNITO_ADMIN_TIMEOUT_MS;
  if (!Number.isInteger(resolved) || resolved < 1_000 || resolved > 600_000) {
    throw new ConfigurationError('Cognito account deletion timeout is invalid');
  }
  return resolved;
}

function isCognitoUserNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string' &&
    error.name === 'UserNotFoundException'
  );
}

function toSanitizedIdentifierSafeAwsErrorMessage(
  error: unknown,
  fallbackMessage: string,
  identifiers: string[],
): string {
  const source = error instanceof Error ? error.message : fallbackMessage;
  const withoutIdentifiers = identifiers.reduce(
    (message, identifier) => message.replaceAll(identifier, '[redacted]'),
    source,
  );
  return toSanitizedAwsErrorMessage(new Error(withoutIdentifiers), fallbackMessage);
}
