import { describe, expect, it } from 'vitest';
import type { CreditBalanceSnapshot } from '../../../../src/domain/types/credit.js';
import type { AuthenticatedUser } from '../../../../src/domain/types/user.js';
import type { UserRepository } from '../../../../src/repositories/UserRepository.js';
import { UserProvisioningService } from '../../../../src/services/auth/UserProvisioningService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../../src/services/credit/CreditService.js';

class FakeUserRepository implements UserRepository {
  public existingUser: AuthenticatedUser | null = null;
  public insertedUser: AuthenticatedUser = buildUser();
  public updatedUser: AuthenticatedUser = buildUser();
  public insertError: unknown = null;

  public async findBySupabaseId(): Promise<AuthenticatedUser | null> {
    return this.existingUser;
  }

  public async insertSupabaseUser(): Promise<AuthenticatedUser> {
    if (this.insertError !== null) {
      throw this.insertError;
    }

    return this.insertedUser;
  }

  public async updateEmail(): Promise<AuthenticatedUser> {
    return this.updatedUser;
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

describe('UserProvisioningService', () => {
  it('新規ユーザー作成時に初回ボーナスを付与する', async () => {
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

  it('既存ユーザーでも初回ボーナス付与を冪等に再確認する', async () => {
    const repository = new FakeUserRepository();
    repository.existingUser = buildUser();
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    const result = await service.provisionFromSupabaseClaims({
      sub: 'supabase-1',
      email: 'user@example.com',
    });

    expect(result).toEqual({
      user: repository.existingUser,
      isNewUser: false,
    });
    expect(creditService.signupBonusUserIds).toEqual(['user-1']);
  });

  it('同時作成競合で既存化したユーザーにも初回ボーナス付与を再確認する', async () => {
    const repository = new FakeUserRepository();
    repository.insertError = { code: '23505' };
    repository.updatedUser = buildUser({ email: 'new@example.com' });
    const creditService = new FakeCreditService();
    const service = new UserProvisioningService(repository, creditService);

    const result = await service.provisionFromSupabaseClaims({
      sub: 'supabase-1',
      email: 'new@example.com',
    });

    expect(result).toEqual({
      user: repository.updatedUser,
      isNewUser: false,
    });
    expect(creditService.signupBonusUserIds).toEqual(['user-1']);
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
