export const mangaTutorialHistoryVersion = 'v1';

export type MangaTutorialHistory = 'seen' | 'unseen' | 'unavailable';

type TutorialHistoryReader = Pick<Storage, 'getItem'>;
type TutorialHistoryWriter = Pick<Storage, 'setItem'>;

export function mangaTutorialHistoryKey(storageScope: string): string {
  return `lyra:web:manga-tutorial:${mangaTutorialHistoryVersion}:${storageScope}`;
}

export function readMangaTutorialHistory(
  storage: TutorialHistoryReader,
  storageScope: string,
): MangaTutorialHistory {
  try {
    return storage.getItem(mangaTutorialHistoryKey(storageScope)) === 'seen'
      ? 'seen'
      : 'unseen';
  } catch {
    return 'unavailable';
  }
}

export function writeMangaTutorialHistory(
  storage: TutorialHistoryWriter,
  storageScope: string,
): boolean {
  try {
    storage.setItem(mangaTutorialHistoryKey(storageScope), 'seen');
    return true;
  } catch {
    return false;
  }
}
