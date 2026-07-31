import { Image } from 'expo-image';

export interface PrivateImageMemoryCachePort {
  clearMemoryCache(): Promise<unknown>;
}

const expoImageMemoryCache: PrivateImageMemoryCachePort = {
  clearMemoryCache: () => Image.clearMemoryCache(),
};

export async function clearPrivateImageMemoryCache(
  cache: PrivateImageMemoryCachePort = expoImageMemoryCache,
): Promise<void> {
  await Promise.allSettled([cache.clearMemoryCache()]);
}
