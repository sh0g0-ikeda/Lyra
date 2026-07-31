import { describe, expect, it } from 'vitest';
import { createAccountDeletionIdentityKey } from '../../../../src/domain/accountDeletion.js';
import type { AccountDeletionIdentityLookupRepository } from '../../../../src/repositories/AccountDeletionRepository.js';
import { AccountDeletionIdentityGuard } from '../../../../src/services/account/AccountDeletionIdentityGuard.js';

class FakeLookup implements AccountDeletionIdentityLookupRepository {
  public blockedKey = '';
  public keys: string[] = [];
  public async hasBlockedIdentityKey(identityKey: string): Promise<boolean> {
    this.keys.push(identityKey);
    return identityKey === this.blockedKey;
  }
}

describe('AccountDeletionIdentityGuard', () => {
  it('raw identityをDBへ渡さず用途別HMAC keyで照合する', async () => {
    const lookup = new FakeLookup();
    const secret = 'account-deletion-secret-with-32-bytes';
    lookup.blockedKey = createAccountDeletionIdentityKey(
      secret,
      'deleted-cognito-sub',
    );
    const guard = new AccountDeletionIdentityGuard(lookup, secret);

    await expect(guard.isBlockedIdentity('deleted-cognito-sub')).resolves.toBe(
      true,
    );
    expect(lookup.keys).toEqual([lookup.blockedKey]);
    expect(lookup.keys).not.toContain('deleted-cognito-sub');
  });
});
