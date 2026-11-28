export type WebWorkspaceView =
  | 'story'
  | 'entities'
  | 'pages'
  | 'assets'
  | 'account'
  | 'tutorial';

const workspaceViews = new Set<WebWorkspaceView>([
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
      : 'story';
  } catch {
    return 'story';
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
