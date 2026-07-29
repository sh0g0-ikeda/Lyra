import { describe, expect, it } from 'vitest';
import type {
  PageAutofillContext,
  PageGenerationContext,
  PageGenerationStateUpdate,
  PagePromptContext,
  PageSummary,
} from '../../../../src/domain/types/page.js';
import type {
  LoadedStoredImage,
  StoredImageLoaderPort,
} from '../../../../src/infrastructure/aws/S3StoredImageLoader.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import type {
  PageThumbnailRendererPort,
  RenderedPageThumbnail,
} from '../../../../src/services/page/PageThumbnailRenderer.js';
import { PageThumbnailService } from '../../../../src/services/page/PageThumbnailService.js';

class FakePageRepository implements PageRepository {
  public page: PageSummary | null = buildPageSummary();
  public lastRequest: {
    pageId: string;
    userId: string;
    organizationId: string | null;
  } | null = null;

  public async findPagesByEpisodeIdAndUserId(): Promise<[]> {
    return [];
  }

  public async findPageByIdAndUserId(
    pageId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<PageSummary | null> {
    this.lastRequest = { pageId, userId, organizationId };
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
      imageData: Buffer.from('full-page-image'),
      mimeType: 'image/png',
    };
  }
}

class FakePageThumbnailRenderer implements PageThumbnailRendererPort {
  public receivedImage: LoadedStoredImage | null = null;

  public async render(image: LoadedStoredImage): Promise<RenderedPageThumbnail> {
    this.receivedImage = image;
    return {
      imageData: Buffer.from('bounded-thumbnail'),
      mimeType: 'image/webp',
    };
  }
}

describe('PageThumbnailService', () => {
  it('thumbnail revisionの確認では原画像を読み込まず所有権だけを検証する', async () => {
    const repository = new FakePageRepository();
    const loader = new FakeStoredImageLoader();
    const renderer = new FakePageThumbnailRenderer();
    const service = new PageThumbnailService(repository, loader, renderer);

    await expect(
      service.getGeneratedImageThumbnailRevision(
        'user-1',
        'page-1',
        'organization-1',
      ),
    ).resolves.toBe('2026-04-24T00:00:00.000Z');
    expect(repository.lastRequest).toEqual({
      pageId: 'page-1',
      userId: 'user-1',
      organizationId: 'organization-1',
    });
    expect(loader.loadedKey).toBeNull();
    expect(renderer.receivedImage).toBeNull();
  });

  it('所有ページの原画像を読み込み、bounded renderer の結果だけを返す', async () => {
    const repository = new FakePageRepository();
    const loader = new FakeStoredImageLoader();
    const renderer = new FakePageThumbnailRenderer();
    const service = new PageThumbnailService(repository, loader, renderer);

    const result = await service.getGeneratedImageThumbnail(
      'user-1',
      'page-1',
      'organization-1',
    );

    expect(repository.lastRequest).toEqual({
      pageId: 'page-1',
      userId: 'user-1',
      organizationId: 'organization-1',
    });
    expect(loader.loadedKey).toBe('session/user-2/pages/page-1/job-1.png');
    expect(renderer.receivedImage).toEqual({
      imageData: Buffer.from('full-page-image'),
      mimeType: 'image/png',
    });
    expect(result).toEqual({
      imageData: Buffer.from('bounded-thumbnail'),
      mimeType: 'image/webp',
      revision: '2026-04-24T00:00:00.000Z',
    });
  });

  it('personal画像のstorage keyが別user scopeなら読み込まない', async () => {
    const repository = new FakePageRepository();
    repository.page = buildPageSummary({
      generatedImage: {
        s3Key: 'session/user-2/pages/page-1/job-1.png',
        cdnUrl: null,
        generationMode: 'standard',
        generatedAt: '2026-04-24T00:00:00.000Z',
      },
    });
    const loader = new FakeStoredImageLoader();
    const renderer = new FakePageThumbnailRenderer();
    const service = new PageThumbnailService(repository, loader, renderer);

    await expect(
      service.getGeneratedImageThumbnail('user-1', 'page-1'),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'generated page thumbnail key is outside the owner scope',
    });
    expect(loader.loadedKey).toBeNull();
    expect(renderer.receivedImage).toBeNull();
  });

  it('generated imageがないページは明示的に拒否する', async () => {
    const repository = new FakePageRepository();
    repository.page = buildPageSummary({ generatedImage: null });
    const service = new PageThumbnailService(
      repository,
      new FakeStoredImageLoader(),
      new FakePageThumbnailRenderer(),
    );

    await expect(
      service.getGeneratedImageThumbnail('user-1', 'page-1'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
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
      s3Key: 'session/user-2/pages/page-1/job-1.png',
      cdnUrl: null,
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
