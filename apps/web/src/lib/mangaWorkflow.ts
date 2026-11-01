export type WebWorkspaceView =
  | 'library'
  | 'story'
  | 'entities'
  | 'pages'
  | 'assets'
  | 'account'
  | 'tutorial';

const workspaceViews = new Set<WebWorkspaceView>([
  'library',
  'story',
  'entities',
  'pages',
  'assets',
  'account',
  'tutorial',
]);

export function readWorkspaceView(
  storage: Pick<Storage, 'getItem'>,
  key: string,
): WebWorkspaceView {
  try {
    const candidate = storage.getItem(key);
    return candidate !== null && workspaceViews.has(candidate as WebWorkspaceView)
      ? candidate as WebWorkspaceView
      : 'library';
  } catch {
    return 'library';
  }
}

export function resumeMangaStep(input: {
  hasEpisode: boolean;
  hasPages: boolean;
  savedStory: string;
}): 'story' | 'entities' | 'pages' {
  if (!input.hasEpisode) return 'story';
  if (input.hasPages) return 'pages';
  if (input.savedStory.trim().length === 0) return 'story';
  return 'entities';
}
