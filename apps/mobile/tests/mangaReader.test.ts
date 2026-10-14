import { describe, expect, it } from 'vitest';

import { buildMangaReadingOrder, findAdjacentEpisode, readerCdnImageSource } from '@/domain/mangaReader';

describe('mangaReader', () => {
  it('章と話の現在orderから作品通算話数を導出し、保存済みIDやorderを変更しない', () => {
    const chapters = [
      { id: 'chapter-b', order: 20, title: '第二章' },
      { id: 'chapter-a', order: 10, title: '第一章' },
    ];
    const episodesByChapter = {
      'chapter-a': [
        { id: 'episode-a2', chapter_id: 'chapter-a', order: 8, title: '後半' },
        { id: 'episode-a1', chapter_id: 'chapter-a', order: 3, title: '始まり' },
      ],
      'chapter-b': [{ id: 'episode-b1', chapter_id: 'chapter-b', order: 5, title: '続き' }],
    };

    const readingOrder = buildMangaReadingOrder(chapters, episodesByChapter);

    expect(readingOrder.map(({ chapterId, chapterOrdinal, episodeId, displayOrdinal }) => ({ chapterId, chapterOrdinal, episodeId, displayOrdinal }))).toEqual([
      { chapterId: 'chapter-a', chapterOrdinal: 1, episodeId: 'episode-a1', displayOrdinal: 1 },
      { chapterId: 'chapter-a', chapterOrdinal: 1, episodeId: 'episode-a2', displayOrdinal: 2 },
      { chapterId: 'chapter-b', chapterOrdinal: 2, episodeId: 'episode-b1', displayOrdinal: 3 },
    ]);
    expect(chapters[0]?.order).toBe(20);
    expect(episodesByChapter['chapter-a']?.[0]?.order).toBe(8);
  });

  it('reader画像は署名済みHTTPS CDNだけを使い、認証headerやAPI fallbackを作らない', () => {
    const generated = { id: 'page-1', episode_id: 'episode-1', generated_image: { cdn_url: 'https://cdn.lyra.test/page.png?signature=short-lived', generated_at: '2026-10-14T00:00:00.000Z' }, updated_at: '2026-10-14T00:00:00.000Z' } as never;
    expect(readerCdnImageSource(generated, { sessionKey: 'session', organizationId: null, episodeId: 'episode-1' })).toEqual({ uri: 'https://cdn.lyra.test/page.png?signature=short-lived', cacheKey: 'reader-image:session:personal:episode-1:page-1:2026-10-14T00%3A00%3A00.000Z' });
    expect(readerCdnImageSource({ ...generated, generated_image: { cdn_url: 'http://cdn.lyra.test/page.png' } } as never, { sessionKey: 'session', organizationId: null, episodeId: 'episode-1' })).toBeNull();
    expect(readerCdnImageSource({ ...generated, generated_image: { cdn_url: null } } as never, { sessionKey: 'session', organizationId: null, episodeId: 'episode-1' })).toBeNull();
    expect(readerCdnImageSource(generated, { sessionKey: 'session', organizationId: null, episodeId: 'other-episode' })).toBeNull();
    expect(readerCdnImageSource(generated, { sessionKey: 'other-session', organizationId: 'org-1', episodeId: 'episode-1' })?.cacheKey)
      .toBe('reader-image:other-session:org-1:episode-1:page-1:2026-10-14T00%3A00%3A00.000Z');
  });

  it('次話と前話を章境界をまたいで見つける', () => {
    const order = buildMangaReadingOrder(
      [{ id: 'chapter-a', order: 1, title: '第一章' }, { id: 'chapter-b', order: 2, title: '第二章' }],
      {
        'chapter-a': [{ id: 'episode-a', chapter_id: 'chapter-a', order: 1, title: '一話' }],
        'chapter-b': [{ id: 'episode-b', chapter_id: 'chapter-b', order: 1, title: '二話' }],
      },
    );

    expect(findAdjacentEpisode(order, 'episode-a', 'next')?.episodeId).toBe('episode-b');
    expect(findAdjacentEpisode(order, 'episode-b', 'previous')?.episodeId).toBe('episode-a');
  });
});
