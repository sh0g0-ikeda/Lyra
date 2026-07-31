import { UnauthorizedError } from '../../domain/errors/index.js';
import { createAccountDeletionIdentityKey } from '../../domain/accountDeletion.js';
import type { AccountDeletionIdentityLookupRepository } from '../../repositories/AccountDeletionRepository.js';

export interface AccountDeletionIdentityGuardPort {
  isBlockedIdentity(identityId: string): Promise<boolean>;
}

export class AccountDeletionIdentityGuard
implements AccountDeletionIdentityGuardPort {
  public constructor(
    private readonly repository: AccountDeletionIdentityLookupRepository,
    private readonly identityKeySecret: string,
  ) {}

  public async isBlockedIdentity(identityId: string): Promise<boolean> {
    return this.repository.hasBlockedIdentityKey(
      createAccountDeletionIdentityKey(this.identityKeySecret, identityId),
    );
  }
}

export async function assertAccountIdentityIsProvisionable(
  guard: AccountDeletionIdentityGuardPort | undefined,
  identityId: string,
): Promise<void> {
  if (guard !== undefined && await guard.isBlockedIdentity(identityId)) {
    throw new UnauthorizedError('Account is not available');
  }
}
