import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../../src/domain/errors/index.js';
import type { CreditBalance, CreditLedgerEntry } from '../../../../src/domain/types/credit.js';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type { CreditRepository } from '../../../../src/repositories/CreditRepository.js';
import { CreditService } from '../../../../src/services/credit/CreditService.js';

const fakeClient = {
  query: async <T extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<T>> => ({
    command: '',
    rowCount: 0,
    oid: 0,
    fields: [],
    rows: [],
  }),
} satisfies DatabaseClient;

class InMemoryCreditRepository implements CreditRepository {
  public readonly ledger: CreditLedgerEntry[] = [];
  private readonly balances = new Map<string, CreditBalance>();

  public async transaction<T>(work: (client: DatabaseClient) => Promise<T>): Promise<T> {
    return work(fakeClient);
  }

  public async getBalance(userId: string): Promise<CreditBalance | null> {
    return this.cloneBalance(this.balances.get(userId) ?? null);
  }

  public async getBalanceForUpdate(userId: string): Promise<CreditBalance | null> {
    return this.getBalance(userId);
  }

  public async createBalance(balance: CreditBalance): Promise<CreditBalance> {
    this.balances.set(balance.userId, this.cloneBalance(balance));
    return this.cloneBalance(balance);
  }

  public async updateBalance(balance: CreditBalance): Promise<CreditBalance> {
    this.balances.set(balance.userId, this.cloneBalance(balance));
    return this.cloneBalance(balance);
  }

  public async hasLedgerEntry(userId: string, type: CreditLedgerEntry['type']): Promise<boolean> {
    return this.ledger.some((entry) => entry.userId === userId && entry.type === type);
  }

  public async insertLedger(entry: CreditLedgerEntry): Promise<void> {
    this.ledger.push({ ...entry });
  }

  public setBalance(balance: CreditBalance): void {
    this.balances.set(balance.userId, this.cloneBalance(balance));
  }

  private cloneBalance(balance: CreditBalance): CreditBalance;
  private cloneBalance(balance: CreditBalance | null): CreditBalance | null;
  private cloneBalance(balance: CreditBalance | null): CreditBalance | null {
    if (balance === null) {
      return null;
    }

    return {
      ...balance,
      monthlyExpiresAt:
        balance.monthlyExpiresAt === null ? null : new Date(balance.monthlyExpiresAt.getTime()),
    };
  }
}

describe('CreditService', () => {
  it('初回ボーナスの場合に購入クレジットへ200cr付与される', async () => {
    const repository = new InMemoryCreditRepository();
    const service = new CreditService(repository);

    const result = await service.grantSignupBonus('user-1');

    expect(result).toEqual({
      monthlyCredits: 0,
      purchasedCredits: 12,
      totalCredits: 12,
      monthlyExpiresAt: null,
    });
    expect(repository.ledger).toHaveLength(1);
    expect(repository.ledger[0]?.type).toBe('signup_bonus');
  });

  it('初回ボーナスは複数回呼んでも一度だけ付与する', async () => {
    const repository = new InMemoryCreditRepository();
    const service = new CreditService(repository);

    await service.grantSignupBonus('user-1');
    const result = await service.grantSignupBonus('user-1');

    expect(result).toEqual({
      monthlyCredits: 0,
      purchasedCredits: 12,
      totalCredits: 12,
      monthlyExpiresAt: null,
    });
    expect(repository.ledger.filter((entry) => entry.type === 'signup_bonus')).toHaveLength(1);
  });

  it('月次残高がある場合に月次から先に消費される', async () => {
    const repository = new InMemoryCreditRepository();
    repository.setBalance({
      userId: 'user-1',
      monthlyCredits: 20,
      purchasedCredits: 10,
      monthlyExpiresAt: null,
    });
    const service = new CreditService(repository);

    const result = await service.consumeCredits({
      userId: 'user-1',
      cost: 25,
      description: 'page generation',
      jobId: 'job-1',
    });

    expect(result.monthlyCredits).toBe(0);
    expect(result.purchasedCredits).toBe(5);
    expect(result.totalCredits).toBe(5);
    expect(repository.ledger[0]?.amount).toBe(-25);
    expect(repository.ledger[0]?.jobId).toBe('job-1');
  });

  it('残高不足の場合にINSUFFICIENT_CREDITSになる', async () => {
    const repository = new InMemoryCreditRepository();
    repository.setBalance({
      userId: 'user-1',
      monthlyCredits: 3,
      purchasedCredits: 4,
      monthlyExpiresAt: null,
    });
    const service = new CreditService(repository);

    await expect(
      service.consumeCredits({
        userId: 'user-1',
        cost: 15,
        description: 'entity generation',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CREDITS' } satisfies Partial<AppError>);
  });

  it('0cr消費の場合にVALIDATION_ERRORになる', async () => {
    const repository = new InMemoryCreditRepository();
    const service = new CreditService(repository);

    await expect(
      service.consumeCredits({
        userId: 'user-1',
        cost: 0,
        description: 'invalid operation',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' } satisfies Partial<AppError>);
  });
  it('返金時はpurchased creditsに加算してrefund台帳を残す', async () => {
    const repository = new InMemoryCreditRepository();
    repository.setBalance({
      userId: 'user-1',
      monthlyCredits: 5,
      purchasedCredits: 7,
      monthlyExpiresAt: null,
    });
    const service = new CreditService(repository);

    const result = await service.refundCredits({
      userId: 'user-1',
      amount: 10,
      description: 'enqueue failure refund',
      jobId: 'job-1',
    });

    expect(result).toEqual({
      monthlyCredits: 5,
      purchasedCredits: 17,
      totalCredits: 22,
      monthlyExpiresAt: null,
    });
    expect(repository.ledger[0]).toMatchObject({
      type: 'refund',
      amount: 10,
      jobId: 'job-1',
    });
  });
});
