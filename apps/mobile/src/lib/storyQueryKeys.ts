export function storyQueryKeys(
  sessionKey: string,
  organizationId: string | null,
): {
  works(): readonly string[];
  chapters(workId: string): readonly string[];
  episodes(chapterId: string): readonly string[];
  scenes(episodeId: string): readonly string[];
  pages(episodeId: string): readonly string[];
  entities(workId: string): readonly string[];
  jobs(): readonly string[];
  job(jobId: string): readonly string[];
} {
  const scope = organizationId === null
    ? 'personal'
    : `organization:${organizationId}`;
  const root = ['mobile-story', sessionKey, scope] as const;

  return {
    works: () => [...root, 'works'] as const,
    chapters: (workId: string) => [...root, 'chapters', workId] as const,
    episodes: (chapterId: string) => [...root, 'episodes', chapterId] as const,
    scenes: (episodeId: string) => [...root, 'scenes', episodeId] as const,
    pages: (episodeId: string) => [...root, 'pages', episodeId] as const,
    entities: (workId: string) => [...root, 'entities', workId] as const,
    jobs: () => [...root, 'jobs'] as const,
    job: (jobId: string) => [...root, 'job', jobId] as const,
  };
}
