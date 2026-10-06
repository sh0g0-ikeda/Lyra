import { describe, expect, it } from 'vitest';
import { creditBalanceState } from '@/domain/creditBalanceState';

// A UI balance is authoritative only after a successful current-scope read.
// Never represent absent, refreshing, inaccessible or invalid data as zero.
describe('creditBalanceState', () => {
  it('実残高0はreadyだがデータ欠損と負数はunavailableになる', () => {
    expect(creditBalanceState({ total: 0 })).toEqual({ status: 'ready', total: 0 });
    expect(creditBalanceState({ total: 127 })).toEqual({ status: 'ready', total: 127 });
    for (const total of [null, undefined, -1, Infinity, NaN]) {
      expect(creditBalanceState({ total }).status).toBe('unavailable');
    }
  });
  it('読込・更新待ち・失敗はキャッシュが残っていても明示する', () => {
    expect(creditBalanceState({ total: undefined, fetching: true }).status).toBe('loading');
    expect(creditBalanceState({ total: 27, fetching: true }).status).toBe('refreshing');
    expect(creditBalanceState({ total: 27, error: true }).status).toBe('error');
    expect(creditBalanceState({ total: 27, offline: true }).status).toBe('offline');
  });
});
