import { describe, expect, it } from 'vitest';
import {
  createAccountDeletionIdentityKey,
  validateAccountDeletionIdentitySecret,
} from '../../../src/domain/accountDeletion.js';

describe('account deletion identity key', () => {
  it('同じ専用secretとidentityなら43文字の同じkeyになる', () => {
    const secret = 'account-deletion-secret-with-32-bytes';

    const first = createAccountDeletionIdentityKey(secret, 'cognito-sub-1');
    const second = createAccountDeletionIdentityKey(secret, 'cognito-sub-1');

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('identityまたは用途別secretが違えば別keyになる', () => {
    expect(
      createAccountDeletionIdentityKey(
        'account-deletion-secret-with-32-bytes',
        'cognito-sub-1',
      ),
    ).not.toBe(
      createAccountDeletionIdentityKey(
        'another-account-deletion-secret-32b',
        'cognito-sub-2',
      ),
    );
  });

  it('短いsecretと空identityを拒否する', () => {
    expect(() => validateAccountDeletionIdentitySecret('too-short')).toThrow(
      'at least 32 characters',
    );
    expect(() =>
      createAccountDeletionIdentityKey(
        'account-deletion-secret-with-32-bytes',
        ' ',
      ),
    ).toThrow('identity');
  });
});
