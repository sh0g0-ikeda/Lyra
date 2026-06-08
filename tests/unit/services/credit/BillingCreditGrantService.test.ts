import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { CreditBalance, CreditLedgerEntry } from '../../../../src/domain/types/credit.js';
import type { DatabaseClient } from '../../../../src/lib/db.js';
import type { CreditRepository } from '../../../../src/repositories/CreditRepository.js';
import { BillingCreditGrantService } from '../../../../src/services/credit/BillingCreditGrantService.js';

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
    return this.clone(this.balances.get(userId) ?? null);
  }

  public async getBalanceForUpdate(userId: string): Promise<CreditBalance | null> {
    return this.getBalance(userId);
  }

  public async createBalance(balance: CreditBalance): Promise<CreditBalance> {
    this.balances.set(balance.userId, this.clone(balance));
    return this.clone(balance);
  }

  public async updateBalance(balance: CreditBalance): Promise<CreditBalance> {
    this.balances.set(balance.userId, this.clone(balance));
    return this.clone(balance);
  }

  public async hasLedgerEntry(userId: string, type: CreditLedgerEntry['type']): Promise<boolean> {
    return this.ledger.some((entry) => entry.userId === userId && entry.type === type);
  }

  public async insertLedger(entry: CreditLedgerEntry): Promise<void> {
    this.ledger.push({ ...entry });
  }

  public setBalance(balance: CreditBalance): void {
    this.balances.set(balance.userId, this.clone(balance));
  }

  private clone(balance: CreditBalance): CreditBalance;
  private clone(balance: CreditBalance | null): CreditBalance | null;
  private clone(balance: CreditBalance | null): CreditBalance | null {
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

describe('BillingCreditGrantService', () => {
  it('月次クレジット付与時は monthly を上書きして expiry を更新する', async () => {
    const repository = new InMemoryCreditRepository();
    repository.setBalance({
      userId: 'user-1',
      monthlyCredits: 120,
      purchasedCredits: 35,
      monthlyExpiresAt: new Date('2026-05-01T00:00:00.000Z'),
    });
    const service = new BillingCreditGrantService(repository);

    const result = await service.grantMonthlyCredits({
      userId: 'user-1',
      amount: 50,
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
      description: 'Monthly renewal',
      stripeEventId: 'evt_1',
    });

    expect(result).toEqual({
      monthlyCredits: 50,
      purchasedCredits: 35,
      totalCredits: 85,
      monthlyExpiresAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(repository.ledger[0]).toMatchObject({
      type: 'monthly_grant',
      amount: 50,
      stripeEventId: 'evt_1',
    });
  });

  it('購入クレジット付与時は purchased に加算して purchase 台帳を残す', async () => {
    const repository = new InMemoryCreditRepository();
    repository.setBalance({
      userId: 'user-1',
      monthlyCredits: 0,
      purchasedCredits: 100,
      monthlyExpiresAt: null,
    });
    const service = new BillingCreditGrantService(repository);

    const result = await service.grantPurchasedCredits({
      userId: 'user-1',
      amount: 10,
      description: 'Credit pack purchase',
      stripeEventId: 'evt_2',
    });

    expect(result).toEqual({
      monthlyCredits: 0,
      purchasedCredits: 110,
      totalCredits: 110,
      monthlyExpiresAt: null,
    });
    expect(repository.ledger[0]).toMatchObject({
      type: 'purchase',
      amount: 10,
      stripeEventId: 'evt_2',
    });
  });
});
