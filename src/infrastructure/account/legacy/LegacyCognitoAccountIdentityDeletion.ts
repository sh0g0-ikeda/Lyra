import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ConfigurationError, ValidationError } from '../../../domain/errors/index.js';
import type { LegacyAccountIdentityDeletionPort } from '../../../legacy/account/LegacyAccountDeletionServiceAdapter.js';
import type {
  LegacyAccountDeletionExternalCallContext,
  LegacyAccountDeletionExternalEffectState,
} from '../../../legacy/account/LegacyAccountDeletionTypes.js';

type LegacyCognitoCommand = AdminDisableUserCommand | AdminDeleteUserCommand | AdminGetUserCommand;

interface LegacyCognitoClient {
  send(
    command: LegacyCognitoCommand,
    options: { abortSignal: AbortSignal },
  ): Promise<{ Enabled?: boolean }>;
}

/**
 * The legacy deletion flow requires separate disable and delete acknowledgements.
 * Reconciliation deliberately accepts only the authoritative states for each step.
 */
export class LegacyCognitoAccountIdentityDeletion
implements LegacyAccountIdentityDeletionPort {
  private readonly timeoutMs: number;
  private readonly userPoolId: string;

  public constructor(
    private readonly client: LegacyCognitoClient,
    userPoolId: string,
    options: { timeoutMs?: number } = {},
  ) {
    this.userPoolId = userPoolId.trim();
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (this.userPoolId.length === 0 || this.userPoolId.length > 128) {
      throw new ConfigurationError('Legacy Cognito user pool id is invalid');
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new ConfigurationError('Legacy Cognito account deletion timeout is invalid');
    }
  }

  public async disableIdentity(
    identityId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<void> {
    const username = normalizeIdentityId(identityId);
    try {
      await this.client.send(new AdminDisableUserCommand({ UserPoolId: this.userPoolId, Username: username }), {
        abortSignal: this.signalFor(context),
      });
    } catch (error: unknown) {
      if (isUserNotFound(error)) return;
      throw new ConfigurationError('Legacy Cognito account identity disable failed');
    }
  }

  public async deleteIdentity(
    identityId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<void> {
    const username = normalizeIdentityId(identityId);
    try {
      await this.client.send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: username }), {
        abortSignal: this.signalFor(context),
      });
    } catch (error: unknown) {
      if (isUserNotFound(error)) return;
      throw new ConfigurationError('Legacy Cognito account identity deletion failed');
    }
  }

  public async reconcileIdentityDisabled(
    identityId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<LegacyAccountDeletionExternalEffectState> {
    const result = await this.readIdentity(identityId, context);
    return result === 'missing' || result === 'disabled' ? 'applied' : 'unknown';
  }

  public async reconcileIdentityDeleted(
    identityId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<LegacyAccountDeletionExternalEffectState> {
    return await this.readIdentity(identityId, context) === 'missing' ? 'applied' : 'unknown';
  }

  private async readIdentity(
    identityId: string,
    context: LegacyAccountDeletionExternalCallContext,
  ): Promise<'enabled' | 'disabled' | 'missing' | 'unknown'> {
    const username = normalizeIdentityId(identityId);
    let abortSignal: AbortSignal;
    try {
      abortSignal = this.signalFor(context);
    } catch {
      return 'unknown';
    }
    try {
      const user = await this.client.send(
        new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: username }),
        { abortSignal },
      );
      return user.Enabled === false ? 'disabled' : 'enabled';
    } catch (error: unknown) {
      return isUserNotFound(error) ? 'missing' : 'unknown';
    }
  }

  private signalFor(context: LegacyAccountDeletionExternalCallContext): AbortSignal {
    const remainingMs = context.deadlineAt - Date.now();
    if (context.signal.aborted || !Number.isFinite(remainingMs) || remainingMs <= 0) {
      throw new ConfigurationError('Legacy Cognito account deletion deadline expired');
    }
    return AbortSignal.any([
      context.signal,
      AbortSignal.timeout(Math.max(1, Math.min(this.timeoutMs, Math.floor(remainingMs)))),
    ]);
  }
}

function normalizeIdentityId(identityId: string): string {
  const normalized = identityId.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new ValidationError('Legacy account identity is invalid');
  }
  return normalized;
}

function isUserNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error
    && error.name === 'UserNotFoundException';
}
