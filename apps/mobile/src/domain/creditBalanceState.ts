export type CreditBalanceState =
  | { status: 'ready'; total: number }
  | { status: 'loading' | 'refreshing' | 'error' | 'offline' | 'unavailable' };

// Keep balance availability separate from its numeric value. In particular,
// cached data must not masquerade as a current quote during refresh or failure.
export function creditBalanceState(input: {
  total?: number | null;
  fetching?: boolean;
  error?: boolean;
  offline?: boolean;
}): CreditBalanceState {
  if (input.offline) return { status: 'offline' };
  if (input.fetching) return { status: input.total == null ? 'loading' : 'refreshing' };
  if (input.error) return { status: 'error' };
  if (typeof input.total !== 'number' || !Number.isFinite(input.total) || input.total < 0) {
    return { status: 'unavailable' };
  }
  return { status: 'ready', total: input.total };
}
