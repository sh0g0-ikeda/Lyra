import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokens } from '../src/domain/auth';

const getItemAsync = vi.fn<(key: string) => Promise<string | null>>();
const setItemAsync = vi.fn<(key: string, value: string) => Promise<void>>();
const deleteItemAsync = vi.fn<(key: string) => Promise<void>>();

vi.mock('expo-secure-store', () => ({
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
}));

describe('auth token storage', () => {
  beforeEach(() => {
    getItemAsync.mockReset();
    setItemAsync.mockReset();
    deleteItemAsync.mockReset();
  });

  it('検証済みtokenだけを保存して読込できる', async () => {
    const tokens = buildTokens();
    const { loadAuthTokens, saveAuthTokens } = await import('../src/lib/storage');
    getItemAsync.mockResolvedValueOnce(JSON.stringify(tokens));

    await saveAuthTokens(tokens);
    await expect(loadAuthTokens()).resolves.toEqual(tokens);

    expect(setItemAsync).toHaveBeenCalledWith(
      'lyra.mobile.auth.tokens',
      JSON.stringify(tokens),
    );
  });

  it('壊れた保存値を削除して未認証として扱う', async () => {
    const { loadAuthTokens } = await import('../src/lib/storage');
    getItemAsync.mockResolvedValueOnce('{"idToken":');

    await expect(loadAuthTokens()).resolves.toBeNull();
    expect(deleteItemAsync).toHaveBeenCalledWith('lyra.mobile.auth.tokens');
  });

  it('schema外のtokenを保存しない', async () => {
    const { saveAuthTokens } = await import('../src/lib/storage');
    const oversized = {
      ...buildTokens(),
      idToken: 'x'.repeat(32_769),
    };

    await expect(saveAuthTokens(oversized)).rejects.toThrow();
    expect(setItemAsync).not.toHaveBeenCalled();
  });
});

function buildTokens(): AuthTokens {
  return {
    idToken: 'id-token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: 1_800_000_000_000,
    tokenType: 'Bearer',
  };
}
