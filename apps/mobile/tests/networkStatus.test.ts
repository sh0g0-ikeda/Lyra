import { describe, expect, it } from 'vitest';

import { normalizeNetworkOnline } from '@/lib/networkStatus';

describe('normalizeNetworkOnline', () => {
  it('端末接続またはinternet到達性がfalseならofflineにする', () => {
    expect(normalizeNetworkOnline({ isConnected: false, isInternetReachable: null })).toBe(false);
    expect(normalizeNetworkOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
  });

  it('到達性の初期値が未確定でも既知の接続を不必要に止めない', () => {
    expect(normalizeNetworkOnline({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(normalizeNetworkOnline({ isConnected: null, isInternetReachable: null })).toBe(true);
  });
});
