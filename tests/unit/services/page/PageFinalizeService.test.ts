import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../../../src/domain/errors/index.js';
import type { GeneratedPageImage, PageGenerationContext, PageGenerationStateUpdate, PagePromptContext } from '../../../../src/domain/types/page.js';
import type { PageGenerationMode } from '../../../../src/domain/types/pageGeneration.js';
import type { PageRepository } from '../../../../src/repositories/PageRepository.js';
import type { FinalPageImageStoragePort, FinalizePageImageInput } from '../../../../src/infrastructure/aws/S3FinalPageImageStorage.js';
import { PageFinalizeService } from '../../../../src/services/page/PageFinalizeService.js';

class FakePageRepository implements PageRepository {
  public context: PageGenerationContext | null = buildPageContext();
  public stateUpdate: PageGenerationStateUpdate | null = null;
  public generatedImageUpdate:
    | { status: string; generationMode: PageGenerationMode | null; generatedImage: GeneratedPageImage }
    | null = null;

  public async findGenerationContextByIdAndUserId(): Promise<PageGenerationContext | null> {
    return this.context;
  }

  public async findPromptContextByIdAndUserId(): Promise<PagePromptContext | null> {
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

class FakeFinalPageImageStorage implements FinalPageImageStoragePort {
  public lastInput: FinalizePageImageInput | null = null;

  public async finalizePageImage(input: FinalizePageImageInput): Promise<GeneratedPageImage> {
    this.lastInput = input;
    return {
      ...input.generatedImage,
      s3Key: `saved/${input.userId}/pages/${input.pageId}_final.png`,
      cdnUrl: `https://img.lyra.app/saved/${input.userId}/pages/${input.pageId}_final.png`,
    };
  }
}

describe('PageFinalizeService', () => {
  it('generated page を confirm して saved 画像へ更新する', async () => {
    const pageRepository = new FakePageRepository();
    const storage = new FakeFinalPageImageStorage();
    const service = new PageFinalizeService(pageRepository, storage);

    await service.confirmPage('user-1', 'page-1');

    expect(storage.lastInput?.sourceS3Key).toBe('session/user-1/pages/page-1/job-1.png');
    expect(pageRepository.generatedImageUpdate).toMatchObject({
      status: 'confirmed',
      generationMode: 'standard',
      generatedImage: {
        s3Key: 'saved/user-1/pages/page-1_final.png',
      },
    });
  });

  it('confirmed page を reopen すると editing に戻す', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ status: 'confirmed' });
    const service = new PageFinalizeService(pageRepository, new FakeFinalPageImageStorage());

    await service.reopenPage('user-1', 'page-1');

    expect(pageRepository.stateUpdate).toEqual({
      status: 'editing',
      generationMode: 'standard',
    });
  });

  it('generated image が無いページは confirm できない', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ generatedImage: null });
    const service = new PageFinalizeService(pageRepository, new FakeFinalPageImageStorage());

    await expect(service.confirmPage('user-1', 'page-1')).rejects.toEqual(
      new ValidationError('Page must have a generated image before confirmation'),
    );
  });

  it('未存在ページは NOT_FOUND', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = null;
    const service = new PageFinalizeService(pageRepository, new FakeFinalPageImageStorage());

    await expect(service.confirmPage('user-1', 'page-1')).rejects.toEqual(
      new NotFoundError('Page not found'),
    );
  });

  it('confirm済みページの再confirmはCONFLICT', async () => {
    const pageRepository = new FakePageRepository();
    pageRepository.context = buildPageContext({ status: 'confirmed' });
    const service = new PageFinalizeService(pageRepository, new FakeFinalPageImageStorage());

    await expect(service.confirmPage('user-1', 'page-1')).rejects.toEqual(
      new ConflictError('Page is already confirmed'),
    );
  });

  it('confirmed以外のreopenはCONFLICT', async () => {
    const service = new PageFinalizeService(new FakePageRepository(), new FakeFinalPageImageStorage());

    await expect(service.reopenPage('user-1', 'page-1')).rejects.toEqual(
      new ConflictError('Only confirmed pages can be reopened'),
    );
  });
});

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
    panels: [],
    ...overrides,
  };
}
