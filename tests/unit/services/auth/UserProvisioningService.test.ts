import { describe, expect, it } from 'vitest';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { AuthenticatedUser } from '../../../../src/domain/types/user.js';
import type { UserRepository } from '../../../../src/repositories/UserRepository.js';
import { UserProvisioningService } from '../../../../src/services/auth/UserProvisioningService.js';
import type { AccountDeletionIdentityGuardPort } from '../../../../src/services/account/AccountDeletionIdentityGuard.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';

class FakeUserRepository implements UserRepository {
  public existingUserBySupabaseId: AuthenticatedUser | null = null;
  public existingUserByEmail: AuthenticatedUser | null = null;
  public firstEmailLookupReturnsNull = false;
  public findByEmailCalls = 0;
  public insertedUser: AuthenticatedUser = buildUser();
  public updatedUser: AuthenticatedUser = buildUser();
  public linkedUser: AuthenticatedUser = buildUser();
  public insertError: unknown = null;
  public updateEmailCalls: Array<{ supabaseId: string; email: string }> = [];
  public linkByEmailCalls: Array<{ email: string; supabaseId: string }> = [];

  public async findBySupabaseId(): Promise<AuthenticatedUser | null> {
    return this.existingUserBySupabaseId;
  }

  public async findByEmail(): Promise<AuthenticatedUser | null> {
    this.findByEmailCalls += 1;
    if (this.firstEmailLookupReturnsNull && this.findByEmailCalls === 1) {
      return null;
    }
    return this.existingUserByEmail;
  }

  public async insertSupabaseUser(): Promise<AuthenticatedUser> {
    if (this.insertError !== null) {
      throw this.insertError;
    }

    return this.insertedUser;
  }

  public async updateEmail(supabaseId: string, email: string): Promise<AuthenticatedUser> {
    this.updateEmailCalls.push({ supabaseId, email });
    return this.updatedUser;
  }

  public async linkSupabaseIdByEmail(email: string, supabaseId: string): Promise<AuthenticatedUser> {
    this.linkByEmailCalls.push({ email, supabaseId });
    return this.linkedUser;
  }
}

class FakeCreditService implements CreditServicePort {
  public signupBonusUserIds: string[] = [];

  public async getBalance(): Promise<CreditBalanceSnapshot> {
    return this.emptyBalance();
  }

  public async grantSignupBonus(userId: string): Promise<CreditBalanceSnapshot> {
    this.signupBonusUserIds.push(userId);
    return this.emptyBalance();
  }

  public async consumeCredits(_params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.emptyBalance();
  }

  public async refundCredits(_params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.emptyBalance();
  }

  private emptyBalance(): CreditBalanceSnapshot {
    return {
      monthlyCredits: 0,
      purchasedCredits: 0,
      totalCredits: 0,
      monthlyExpiresAt: null,
    };
  }
}

class FakeAccountDeletionIdentityGuard implements AccountDeletionIdentityGuardPort {
  public blocked = false;
  public checkedIdentities: string[] = [];

  public async isBlockedIdentity(identityId: string): Promise<boolean> {
    this.checkedIdentities.push(identityId);
    return this.blocked;
  }
}

describe('UserProvisioningService', () => {
  it('新規ユーザー作成時だけ初回ボーナスを付与する', async () => {
    const repository = new FakeUserRepository();
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    const result = await service.provisionFromSupabaseClaims({
      sub: 'supabase-1',
      email: 'user@example.com',
    });

    expect(result).toEqual({
      user: repository.insertedUser,
      isNewUser: true,
    });
    expect(creditService.signupBonusUserIds).toEqual(['user-1']);
  });

  it('既存ユーザーでは初回ボーナスを再付与しない', async () => {
    const repository = new FakeUserRepository();
    repository.existingUserBySupabaseId = buildUser();
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    const result = await service.provisionFromSupabaseClaims({
      sub: 'supabase-1',
      email: 'user@example.com',
    });

    expect(result).toEqual({
      user: repository.existingUserBySupabaseId,
      isNewUser: false,
    });
    expect(creditService.signupBonusUserIds).toEqual([]);
  });

  it('既存ユーザーのメールが変わった場合はメールだけ同期する', async () => {
    const repository = new FakeUserRepository();
    repository.existingUserBySupabaseId = buildUser({ email: 'old@example.com' });
    repository.updatedUser = buildUser({ email: 'new@example.com' });
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    const result = await service.provisionFromSupabaseClaims({
      sub: 'supabase-1',
      email: 'New@Example.com',
    });

    expect(result).toEqual({
      user: repository.updatedUser,
      isNewUser: false,
    });
    expect(repository.updateEmailCalls).toEqual([{ supabaseId: 'supabase-1', email: 'new@example.com' }]);
    expect(creditService.signupBonusUserIds).toEqual([]);
  });

  it('同じメールで認証プロバイダーIDが変わった場合は既存ユーザーに再リンクする', async () => {
    const repository = new FakeUserRepository();
    repository.existingUserByEmail = buildUser({ supabaseId: 'old-provider-sub' });
    repository.linkedUser = buildUser({ supabaseId: 'new-provider-sub' });
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    const result = await service.provisionFromSupabaseClaims({
      sub: 'new-provider-sub',
      email: 'USER@example.com',
    });

    expect(result).toEqual({
      user: repository.linkedUser,
      isNewUser: false,
    });
    expect(repository.linkByEmailCalls).toEqual([
      { email: 'user@example.com', supabaseId: 'new-provider-sub' },
    ]);
    expect(creditService.signupBonusUserIds).toEqual([]);
  });

  // Spec §4: 既存Cognito移行は維持し、外部IdPのメール一致だけでは既存資産の所有者を変えない。
  it('Google由来の別subjectが既存メールと一致する場合はユーザーを付け替えない', async () => {
    const repository = new FakeUserRepository();
    repository.existingUserByEmail = buildUser({ supabaseId: 'native-sub' });
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    await expect(service.provisionFromSupabaseClaims({
      sub: 'google-sub',
      email: 'user@example.com',
      identityProvider: 'federated',
    })).rejects.toMatchObject({ code: 'ACCOUNT_LINK_REQUIRED', statusCode: 409 });

    expect(repository.linkByEmailCalls).toEqual([]);
    expect(creditService.signupBonusUserIds).toEqual([]);
  });

  it('連携済みGoogle subjectが既存ユーザーと一致する場合は同じ内部IDで返す', async () => {
    const repository = new FakeUserRepository();
    repository.existingUserBySupabaseId = buildUser({ supabaseId: 'linked-sub' });
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    const result = await service.provisionFromSupabaseClaims({
      sub: 'linked-sub',
      email: 'user@example.com',
      identityProvider: 'federated',
    });

    expect(result.user.id).toBe(repository.existingUserBySupabaseId.id);
    expect(result.isNewUser).toBe(false);
    expect(repository.linkByEmailCalls).toEqual([]);
    expect(creditService.signupBonusUserIds).toEqual([]);
  });

  it('Google初回登録のemail一意競合でも既存ユーザーへ付け替えない', async () => {
    const repository = new FakeUserRepository();
    repository.insertError = { code: '23505' };
    repository.existingUserByEmail = buildUser({ supabaseId: 'native-sub' });
    repository.firstEmailLookupReturnsNull = true;
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    await expect(service.provisionFromSupabaseClaims({
      sub: 'google-sub',
      email: 'user@example.com',
      identityProvider: 'federated',
    })).rejects.toMatchObject({ code: 'ACCOUNT_LINK_REQUIRED', statusCode: 409 });

    expect(repository.linkByEmailCalls).toEqual([]);
    expect(repository.findByEmailCalls).toBe(2);
    expect(creditService.signupBonusUserIds).toEqual([]);
  });

  it('同時作成競合で既存化したユーザーを返す', async () => {
    const repository = new FakeUserRepository();
    repository.insertError = { code: '23505' };
    repository.existingUserBySupabaseId = buildUser({ email: 'new@example.com' });
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    const result = await service.provisionFromSupabaseClaims({
      sub: 'supabase-1',
      email: 'new@example.com',
    });

    expect(result).toEqual({
      user: repository.existingUserBySupabaseId,
      isNewUser: false,
    });
    expect(creditService.signupBonusUserIds).toEqual([]);
  });

  it('subject lookupで見つからない削除開始済みidentityは再作成しない', async () => {
    const repository = new FakeUserRepository();
    const creditService = new FakeCreditService();
    const guard = new FakeAccountDeletionIdentityGuard();
    guard.blocked = true;
    const service = new UserProvisioningService(repository, creditService, guard);

    await expect(
      service.provisionFromSupabaseClaims({
        sub: 'deleted-cognito-sub',
        email: 'user@example.com',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(guard.checkedIdentities).toEqual(['deleted-cognito-sub']);
    expect(creditService.signupBonusUserIds).toEqual([]);
  });

  it('既存identityは追加guard queryなしで従来どおり返す', async () => {
    const repository = new FakeUserRepository();
    repository.existingUserBySupabaseId = buildUser();
    const guard = new FakeAccountDeletionIdentityGuard();
    const service = new UserProvisioningService(repository, new FakeCreditService(), guard);

    await expect(
      service.provisionFromSupabaseClaims({
        sub: 'supabase-1',
        email: 'user@example.com',
      }),
    ).resolves.toMatchObject({ isNewUser: false });

    expect(guard.checkedIdentities).toEqual([]);
  });
});

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    supabaseId: 'supabase-1',
    email: 'user@example.com',
    displayName: null,
    planCode: 'free',
    ...overrides,
  };
}
