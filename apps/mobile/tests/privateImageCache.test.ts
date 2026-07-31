import { describe, expect, it, vi } from 'vitest';
import { clearPrivateImageMemoryCache } from '../src/lib/privateImageCache';

vi.mock('expo-image', () => ({
  Image: { clearMemoryCache: vi.fn() },
}));

describe('private image cache', () => {
  it('logout時のmemory cache消去失敗を外へ漏らさない', async () => {
    const clearMemoryCache = vi.fn().mockRejectedValue(new Error('native cache unavailable'));

    await expect(clearPrivateImageMemoryCache({ clearMemoryCache })).resolves.toBeUndefined();
    expect(clearMemoryCache).toHaveBeenCalledOnce();
  });
});
