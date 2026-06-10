import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/domain/errors/index.js';
import type { Balloon } from '../../../../src/domain/types/balloon.js';
import type {
  GeneratedPageImage,
  PageGenerationContext,
  PageGenerationStateUpdate,
  PageSummary,
  PagePromptContext,
} from '../../../../src/domain/types/page.js';
import type { PageGenerationMode } from '../../../../src/domain/types/pageGeneration.js';
import type { StoredImageLoaderPort } from '../../../../src/infrastructure/aws/S3StoredImageLoader.js';
import type {
  FinalPageImageStoragePort,
  FinalizePageImageInput,
} from '../../../../src/infrastructure/aws/S3FinalPageImageStorage.js';
import type { BalloonRepository } from '../../../../src/repositories/BalloonRepository.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import { PageFinalizeService } from '../../../../src/services/page/PageFinalizeService.js';
import type { PageBalloonComposerPort } from '../../../../src/services/page/PageBalloonComposer.js';

class FakePageRepository implements PageRepository {
  public context: PageGenerationContext | null = buildPageContext();
  public stateUpdate: PageGenerationStateUpdate | null = null;
  public generatedImageUpdate:
    | { status: string; generationMode: PageGenerationMode | null; generatedImage: GeneratedPageImage }
    | null = null;

  public async findPagesByEpisodeIdAndUserId(): Promise<[]> {
    return [];
  }

  public async findPageByIdAndUserId(): Promise<PageSummary | null> {
    return null;
  }

  public async findGenerationContextByIdAndUserId(): Promise<PageGenerationContext | null> {
    return this.context;
  }

  public async findPromptContextByIdAndUserId(): Promise<PagePromptContext | null> {
    throw new Error('not used');
  }

  public async findAutofillContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async findEpisodePlanningContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async updatePageSettings(): Promise<PageSummary | null> {
    throw new Error('not used');
  }

  public async updateGenerationState(
    _pageId: string,
    _userId: string,
    input: PageGenerationStateUpdate,
  ): Promise<boolean> {
    this.stateUpdate = input;
    return true;
  }

  public async updateGeneratedImageAndState(
    _pageId: string,
    _userId: string,
    input: { status: string; generationMode: PageGenerationMode | null; generatedImage: GeneratedPageImage },
  ): Promise<boolean> {
    this.generatedImageUpdate = input;
    return true;
  }
}

class FakeBalloonRepository implements BalloonRepository {
  public balloons: Balloon[] = [];

  public async findPageContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async findBalloonContextByIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async createBalloon(): Promise<never> {
    throw new Error('not used');
  }

  public async findBalloonsByPageIdAndUserId(): Promise<Balloon[]> {
    return this.balloons;
  }

  public async replaceBalloonsByPageIdAndUserId(): Promise<never> {
    throw new Error('not used');
  }

  public async updateBalloon(): Promise<never> {
    throw new Error('not used');
  }

  public async deleteBalloon(): Promise<boolean> {
    return false;
  }
}

class FakeStoredImageLoader implements StoredImageLoaderPort {
  public loadedKey: string | null = null;

  public async loadByS3Key(s3Key: string): Promise<{ imageData: Buffer; mimeType: 'image/png' }> {
    this.loadedKey = s3Key;
    return {
      imageData: Buffer.from('source-image'),
      mimeType: 'image/png',
    };
  }
}

class FakePageBalloonComposer implements PageBalloonComposerPort {
  public input: { pageImage: Buffer; balloons: Balloon[] } | null = null;

  public async compose(input: { pageImage: Buffer; balloons: Balloon[] }): Promise<{
    imageData: Buffer;
    mimeType: 'image/png';
  }> {
    this.input = input;
    return {
      imageData: Buffer.from('composed-image'),
      mimeType: 'image/png',
    };
  }
}

class FakeFinalPageImageStorage implements FinalPageImageStoragePort {
  public lastCopyInput: FinalizePageImageInput | null = null;
  public lastStoredInput:
    | {
        userId: string;
        pageId: string;
        imageData: Buffer;
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
        generatedImage: GeneratedPageImage;
      }
    | null = null;

  public async finalizePageImage(input: FinalizePageImageInput): Promise<GeneratedPageImage> {
    this.lastCopyInput = input;
    return {
      ...input.generatedImage,
      s3Key: `saved/${input.userId}/pages/${input.pageId}_final.png`,
      cdnUrl: `https://img.lyra.app/saved/${input.userId}/pages/${input.pageId}_final.png`,
    };
  }

  public async storeFinalPageImage(input: {
    userId: string;
    pageId: string;
    imageData: Buffer;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    generatedImage: GeneratedPageImage;
  }): Promise<GeneratedPageImage> {
    this.lastStoredInput = input;
    return {
      ...input.generatedImage,
      s3Key: `saved/${input.userId}/pages/${input.pageId}_final.png`,
      cdnUrl: `https://img.lyra.app/saved/${input.userId}/pages/${input.pageId}_final.png`,
    };
  }
}

describe('PageFinalizeService', () => {
  it('balloon がない generated page は copy で confirm する', async () => {
    const pageRepository = new FakePageRepository();
    const balloonRepository = new FakeBalloonRepository();
    const storage = new FakeFinalPageImageStorage();
    const service = buildService({
      pageRepository,
      balloonRepository,
      storage,
    });

    await service.confirmPage('user-1', 'page-1');

    expect(storage.lastCopyInput?.sourceS3Key).toBe('session/user-1/pages/page-1/job-1.png');
    expect(storage.lastStoredInput).toBeNull();
    expect(pageRepository.generatedImageUpdate).toMatchObject({
      status: 'confirmed',
      generationMode: 'standard',
      generatedImage: {
        s3Key: 'saved/user-1/pages/page-1_final.png',
      },
    });
  });

  it('balloon がある generated page は合成して upload する', async () => {
    const pageRepository = new FakePageRepository();
    const balloonRepository = new FakeBalloonRepository();
    balloonRepository.balloons = [
      {
        id: 'balloon-1',
        pageId: 'page-1',
        speakerEntityId: null,
        balloonType: 'speech',
        writingMode: 'vertical',
        text: 'hello',
        position: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        tail: null,
        fontSize: 18,
        fontFamily: 'manga_gothic',
        panelOrderReference: 1,
        zIndex: 10,
      },
    ];
    const storedImageLoader = new FakeStoredImageLoader();
    const balloonComposer = new FakePageBalloonComposer();
    const storage = new FakeFinalPageImageStorage();
    const service = buildService({
      pageRepository,
      balloonRepository,
      storedImageLoader,
      balloonComposer,
      storage,
    });

    await service.confirmPage('user-1', 'page-1');

    expect(storedImageLoader.loadedKey).toBe('session/user-1/pages/page-1/job-1.png');
    expect(balloonComposer.input?.balloons).toHaveLength(1);
    expect(storage.lastCopyInput).toBeNull();
    expect(storage.lastStoredInput?.imageData.toString()).toBe('composed-image');
  });

  it('confirmed page を reopen すると editing に戻る', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ status: 'confirmed' });
    const service = buildService({ pageRepository });

    await service.reopenPage('user-1', 'page-1');

    expect(pageRepository.stateUpdate).toEqual({
      status: 'editing',
      generationMode: 'standard',
    });
  });

  it('generated image がないページは confirm できない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ generatedImage: null });
    const service = buildService({ pageRepository });

    await expect(service.confirmPage('user-1', 'page-1')).rejects.toEqual(
      new ValidationError('Page must have a generated image before confirmation'),
    );
  });

  it('未存在ページは NOT_FOUND', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = null;
    const service = buildService({ pageRepository });

    await expect(service.confirmPage('user-1', 'page-1')).rejects.toEqual(
      new NotFoundError('Page not found'),
    );
  });

  it('confirm 済みページの confirm は CONFLICT', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ status: 'confirmed' });
    const service = buildService({ pageRepository });

    await expect(service.confirmPage('user-1', 'page-1')).rejects.toEqual(
      new ConflictError('Page is already confirmed'),
    );
  });

  it('confirmed 以外の reopen は CONFLICT', async () => {
    const service = buildService();

    await expect(service.reopenPage('user-1', 'page-1')).rejects.toEqual(
      new ConflictError('Only confirmed pages can be reopened'),
    );
  });

  it('generated image key が所有者スコープ外なら confirm 前に拒否する', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({
      generatedImage: {
        s3Key: 'session/user-2/pages/page-1/job-1.png',
        cdnUrl: 'https://img.lyra.app/session/user-2/pages/page-1/job-1.png',
        generationMode: 'standard',
        generatedAt: '2026-04-24T00:00:00.000Z',
      },
    });
    const storage = new FakeFinalPageImageStorage();
    const service = buildService({ pageRepository, storage });

    await expect(service.confirmPage('user-1', 'page-1')).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
      message: 'generated page image key is outside the owner scope',
    });
    expect(storage.lastCopyInput).toBeNull();
    expect(storage.lastStoredInput).toBeNull();
  });
});

function buildService(overrides: {
  pageRepository?: FakePageRepository;
  balloonRepository?: FakeBalloonRepository;
  storedImageLoader?: FakeStoredImageLoader;
  balloonComposer?: FakePageBalloonComposer;
  storage?: FakeFinalPageImageStorage;
} = {}): PageFinalizeService {
  return new PageFinalizeService(
    overrides.pageRepository ?? new FakePageRepository(),
    overrides.balloonRepository ?? new FakeBalloonRepository(),
    overrides.storedImageLoader ?? new FakeStoredImageLoader(),
    overrides.balloonComposer ?? new FakePageBalloonComposer(),
    overrides.storage ?? new FakeFinalPageImageStorage(),
  );
}

function buildPageContext(overrides: Partial<PageGenerationContext> = {}): PageGenerationContext {
  return {
    pageId: 'page-1',
    workId: 'work-1',
    layoutConfig: { type: 'template' },
    generatedImage: {
      s3Key: 'session/user-1/pages/page-1/job-1.png',
      cdnUrl: 'https://img.lyra.app/session/user-1/pages/page-1/job-1.png',
      generationMode: 'standard',
      generatedAt: '2026-04-24T00:00:00.000Z',
    },
    generationMode: 'standard',
    status: 'generated',
    frameCount: 1,
    panels: [],
    ...overrides,
  };
}
