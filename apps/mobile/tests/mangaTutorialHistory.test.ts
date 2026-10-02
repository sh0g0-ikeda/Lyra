import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock('expo-secure-store', () => store);

// Design 05 §2: tutorial history is versioned, device-local and optional.
// Corrupt / older history must not suppress a new tutorial, while storage failure
// must never block access to production editors or cause an unhandled rejection.
describe('manga tutorial history', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('初回と古いversionでは案内が必要になり、現在versionで完了すると不要になる', async () => {
    const history = await import('@/lib/mangaTutorialHistory');
    store.getItemAsync.mockResolvedValueOnce(null).mockResolvedValueOnce('old').mockResolvedValueOnce(history.mangaTutorialVersion);
    expect(await history.loadMangaTutorialHistory()).toBe('unseen');
    expect(await history.loadMangaTutorialHistory()).toBe('unseen');
    expect(await history.loadMangaTutorialHistory()).toBe('seen');
    expect(store.getItemAsync).toHaveBeenCalledWith('lyra.mobile.manga-tutorial.version');
  });

  it('完了とskipは現在versionを保存し、再mountしても同sessionでは再表示しない', async () => {
    const history = await import('@/lib/mangaTutorialHistory');
    store.setItemAsync.mockResolvedValue(undefined);
    expect(await history.markMangaTutorialSeen()).toBe(true);
    expect(store.setItemAsync).toHaveBeenCalledWith('lyra.mobile.manga-tutorial.version', history.mangaTutorialVersion);
    expect(await history.loadMangaTutorialHistory()).toBe('seen');
  });

  it('読込失敗は未読や0等で代用せずunavailableにし、保存失敗でも続行できる', async () => {
    const history = await import('@/lib/mangaTutorialHistory');
    store.getItemAsync.mockRejectedValue(new Error('private device detail'));
    expect(await history.loadMangaTutorialHistory()).toBe('unavailable');
    store.setItemAsync.mockRejectedValue(new Error('private device detail'));
    expect(await history.markMangaTutorialSeen()).toBe(false);
    expect(await history.loadMangaTutorialHistory()).toBe('seen');
  });
});
