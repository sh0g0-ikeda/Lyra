import { describe, expect, it } from 'vitest';
import { createAccountDeletionIdentityKey } from '../../../../src/domain/accountDeletion.js';
import type { AccountDeletionIdentityLookupRepository } from '../../../../src/repositories/AccountDeletionRepository.js';
import { AccountDeletionIdentityGuard } from '../../../../src/services/account/AccountDeletionIdentityGuard.js';

class FakeLookup implements AccountDeletionIdentityLookupRepository {
  public blockedKey = '';
  public inputs: Array<{ identityId: string; identityKey: string | null }> = [];
  public async hasBlockedIdentity(input: { identityId: string; identityKey: string | null }): Promise<boolean> {
    this.inputs.push(input);
    return input.identityKey === this.blockedKey || (input.identityKey === null && input.identityId === 'deleted-cognito-sub');
  }
}

describe('AccountDeletionIdentityGuard', () => {
  it('canonical secretから用途別HMAC keyを生成してlookupへ渡す', async () => {
    const lookup = new FakeLookup();
    const secret = 'account-deletion-secret-with-32-bytes';
    lookup.blockedKey = createAccountDeletionIdentityKey(
      secret,
      'deleted-cognito-sub',
    );
    const guard = new AccountDeletionIdentityGuard(lookup, secret);

    expect(await guard.isBlockedIdentity('deleted-cognito-sub')).toBe(true);
    expect(lookup.inputs).toEqual([{
      identityId: 'deleted-cognito-sub',
      identityKey: lookup.blockedKey,
    }]);
  });

  it('secret未設定のlegacy lookupへraw identityとnull keyを渡す', async () => {
    const lookup = new FakeLookup();
    const guard = new AccountDeletionIdentityGuard(lookup);
    expect(await guard.isBlockedIdentity('deleted-cognito-sub')).toBe(true);
    expect(lookup.inputs).toEqual([{
      identityId: 'deleted-cognito-sub',
      identityKey: null,
    }]);
  });
});
