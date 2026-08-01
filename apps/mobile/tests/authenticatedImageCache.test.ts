import { describe, expect, it, vi } from 'vitest';

import { clearAuthenticatedImageCache } from '@/lib/authenticatedImageCache';

vi.mock('expo-image', () => ({
  Image: {
    clearDiskCache: vi.fn().mockResolvedValue(true),
    clearMemoryCache: vi.fn().mockResolvedValue(true)
  }
}));

describe('authenticated image cache lifecycle', () => {
  it('memoryとdisk cacheを両方消去する', async () => {
    const adapter = {
      clearDiskCache: vi.fn().mockResolvedValue(true),
      clearMemoryCache: vi.fn().mockResolvedValue(true)
    };

    await clearAuthenticatedImageCache(adapter);

    expect(adapter.clearMemoryCache).toHaveBeenCalledOnce();
    expect(adapter.clearDiskCache).toHaveBeenCalledOnce();
  });

  it('片方の消去失敗でももう片方を必ず試す', async () => {
    const adapter = {
      clearDiskCache: vi.fn().mockRejectedValue(new Error('disk unavailable')),
      clearMemoryCache: vi.fn().mockResolvedValue(true)
    };

    await expect(clearAuthenticatedImageCache(adapter)).resolves.toBeUndefined();
    expect(adapter.clearMemoryCache).toHaveBeenCalledOnce();
    expect(adapter.clearDiskCache).toHaveBeenCalledOnce();
  });
});
