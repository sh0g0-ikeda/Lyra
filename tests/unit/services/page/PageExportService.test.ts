import { describe, expect, it } from 'vitest';
import type {
  PageAutofillContext,
  PageGenerationContext,
  PageGenerationStateUpdate,
  PagePromptContext,
  PageSummary,
} from '../../../../src/domain/types/page.js';
import type { LoadedStoredImage, StoredImageLoaderPort } from '../../../../src/infrastructure/aws/S3StoredImageLoader.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import { PageExportService } from '../../../../src/services/page/PageExportService.js';

class FakePageRepository implements PageRepository {
  public page: PageSummary | null = buildPageSummary();
  public lastRequest: { pageId: string; userId: string } | null = null;

  public async findPagesByEpisodeIdAndUserId(): Promise<[]> {
    return [];
  }

  public async findPageByIdAndUserId(pageId: string, userId: string): Promise<PageSummary | null> {
    this.lastRequest = { pageId, userId };
    return this.page;
  }

  public async findAutofillContextByIdAndUserId(): Promise<PageAutofillContext | null> {
    throw new Error('not used');
  }

  public async findEpisodePlanningContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async findGenerationContextByIdAndUserId(): Promise<PageGenerationContext | null> {
    throw new Error('not used');
  }

  public async findPromptContextByIdAndUserId(): Promise<PagePromptContext | null> {
    throw new Error('not used');
  }

  public async updatePageSettings(): Promise<PageSummary | null> {
    throw new Error('not used');
  }

  public async updateGenerationState(
    _pageId: string,
    _userId: string,
    _input: PageGenerationStateUpdate,
  ): Promise<boolean> {
    throw new Error('not used');
  }

  public async updateGeneratedImageAndState(): Promise<boolean> {
    throw new Error('not used');
  }
}

class FakeStoredImageLoader implements StoredImageLoaderPort {
  public loadedKey: string | null = null;

  public async loadByS3Key(s3Key: string): Promise<LoadedStoredImage> {
    this.loadedKey = s3Key;
    return {
      imageData: Buffer.from('page-image'),
      mimeType: 'image/png',
    };
  }
}

describe('PageExportService', () => {
  it('loads an owned generated page image by s3_key', async () => {
    const repository = new FakePageRepository();
    const loader = new FakeStoredImageLoader();
    const service = new PageExportService(repository, loader);

    const result = await service.exportGeneratedImage('user-1', 'page-1');

    expect(repository.lastRequest).toEqual({ pageId: 'page-1', userId: 'user-1' });
    expect(loader.loadedKey).toBe('session/user-1/pages/page-1/job-1.png');
    expect(result).toEqual({
      imageData: Buffer.from('page-image'),
      mimeType: 'image/png',
    });
  });

  it('rejects a generated page image outside the owner scope before loading', async () => {
    const repository = new FakePageRepository();
    repository.page = buildPageSummary({
      generatedImage: {
        s3Key: 'session/user-2/pages/page-1/job-1.png',
        cdnUrl: 'https://img.lyra.app/session/user-2/pages/page-1/job-1.png',
        generationMode: 'standard',
        generatedAt: '2026-04-24T00:00:00.000Z',
      },
    });
    const loader = new FakeStoredImageLoader();
    const service = new PageExportService(repository, loader);

    await expect(service.exportGeneratedImage('user-1', 'page-1')).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'generated page image key is outside the owner scope',
    });
    expect(loader.loadedKey).toBeNull();
  });
});

function buildPageSummary(overrides: Partial<PageSummary> = {}): PageSummary {
  return {
    id: 'page-1',
    episodeId: 'episode-1',
    pageNumber: 1,
    layoutConfig: { type: 'template' },
    storySourceSceneIds: [],
    storyPagePurpose: null,
    storyContinuityNote: null,
    dialogueMode: 'image_baked',
    pageDialogueToggle: true,
    generationMode: 'standard',
    generatedImage: {
      s3Key: 'session/user-1/pages/page-1/job-1.png',
      cdnUrl: 'https://img.lyra.app/session/user-1/pages/page-1/job-1.png',
      generationMode: 'standard',
      generatedAt: '2026-04-24T00:00:00.000Z',
    },
    status: 'generated',
    panelCount: 1,
    frameCount: 1,
    balloonCount: 0,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
    ...overrides,
  };
}
