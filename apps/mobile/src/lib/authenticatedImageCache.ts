import { Image as ExpoImage } from 'expo-image';

export interface AuthenticatedImageCacheAdapter {
  clearDiskCache(): Promise<unknown>;
  clearMemoryCache(): Promise<unknown>;
}

const expoImageCacheAdapter: AuthenticatedImageCacheAdapter = {
  clearDiskCache: () => ExpoImage.clearDiskCache(),
  clearMemoryCache: () => ExpoImage.clearMemoryCache()
};

export async function clearAuthenticatedImageCache(
  adapter: AuthenticatedImageCacheAdapter = expoImageCacheAdapter
): Promise<void> {
  await Promise.allSettled([
    adapter.clearMemoryCache(),
    adapter.clearDiskCache()
  ]);
}

export async function clearAuthenticatedImageMemoryCache(
  adapter: Pick<AuthenticatedImageCacheAdapter, 'clearMemoryCache'> = expoImageCacheAdapter
): Promise<void> {
  await Promise.allSettled([adapter.clearMemoryCache()]);
}
