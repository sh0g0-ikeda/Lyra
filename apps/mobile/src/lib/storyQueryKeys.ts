export function storyQueryKeys(
  sessionKey: string,
  organizationId: string | null,
): {
  works(): readonly string[];
  chapters(workId: string): readonly string[];
  episodes(chapterId: string): readonly string[];
} {
  const scope = organizationId === null
    ? 'personal'
    : `organization:${organizationId}`;
  const root = ['mobile-story', sessionKey, scope] as const;

  return {
    works: () => [...root, 'works'] as const,
    chapters: (workId: string) => [...root, 'chapters', workId] as const,
    episodes: (chapterId: string) => [...root, 'episodes', chapterId] as const,
  };
}
