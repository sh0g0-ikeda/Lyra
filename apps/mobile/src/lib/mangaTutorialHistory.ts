import * as SecureStore from 'expo-secure-store';

export const mangaTutorialVersion = '2026-10-01.1';
const storageKey = 'lyra.mobile.manga-tutorial.version';
let handledThisSession = false;

// This is an optional device-local presentation preference, never account or
// production state. Failure may not prevent dismissing or replaying the tutorial.
export async function loadMangaTutorialHistory(): Promise<'seen' | 'unseen' | 'unavailable'> {
  if (handledThisSession) return 'seen';
  try {
    const version = await SecureStore.getItemAsync(storageKey);
    return handledThisSession || version === mangaTutorialVersion ? 'seen' : 'unseen';
  } catch {
    return 'unavailable';
  }
}

export async function markMangaTutorialSeen(): Promise<boolean> {
  handledThisSession = true;
  try {
    await SecureStore.setItemAsync(storageKey, mangaTutorialVersion);
    return true;
  } catch {
    return false;
  }
}
