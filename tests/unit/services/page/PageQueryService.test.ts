import { describe, expect, it } from 'vitest';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import type { StoryRepository } from '../../../../src/repositories/StoryRepository.js';
import { PageQueryService } from '../../../../src/services/page/PageQueryService.js';
import type { PageSummary } from '../../../../src/domain/types/page.js';

const page: PageSummary = {
  id: '33333333-3333-4333-8333-333333333333',
  episodeId: '22222222-2222-4222-8222-222222222222',
  pageNumber: 1,
  layoutConfig: { type: 'template', template_id: 'standard_4' },
  storySourceSceneIds: [], storyPagePurpose: null, storyContinuityNote: null,
  dialogueMode: 'mixed', pageDialogueToggle: true, generationMode: null, generatedImage: null,
  status: 'designing', panelCount: 4, frameCount: 4, balloonCount: 0,
  createdAt: new Date('2026-05-01T00:00:00.000Z'), updatedAt: new Date('2026-05-01T00:00:00.000Z'),
};

describe('PageQueryService', () => {
  it('delegates a bounded page list only after authenticating the episode', async () => {
    const pageRepository = {
      findPagesPageByEpisodeIdAndUserId: async () => ({ items: [page], nextCursor: null }),
    } as unknown as PageRepository;
    const storyRepository = {
      findEpisodeByIdAndUserId: async () => ({ id: page.episodeId }),
    } as unknown as StoryRepository;
    const service = new PageQueryService(pageRepository, storyRepository);

    await expect(service.listEpisodePagesPage('user-1', page.episodeId, { limit: 2, cursor: null }))
      .resolves.toEqual({ items: [page], nextCursor: null });
  });

  it('returns the selected page only when the repository grants tenant-scoped access', async () => {
    let received: readonly unknown[] | null = null;
    const pageRepository = {
      findPageByIdAndUserId: async (...args: readonly unknown[]) => {
        received = args;
        return page;
      },
    } as unknown as PageRepository;
    const service = new PageQueryService(pageRepository, {} as StoryRepository);

    await expect(service.getPage('user-1', page.id, '99999999-9999-4999-8999-999999999999')).resolves.toEqual(page);
    expect(received).toEqual([page.id, 'user-1', '99999999-9999-4999-8999-999999999999']);
  });
});
