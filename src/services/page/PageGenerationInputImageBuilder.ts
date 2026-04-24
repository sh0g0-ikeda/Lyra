import { NotFoundError } from '../../domain/errors/index.js';
import type { PageGenerationInputImage } from '../../domain/types/pageGeneration.js';
import type { EntityRepository } from '../../repositories/EntityRepository.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';

export interface BuildPageGenerationInputImagesInput {
  userId: string;
  pageId: string;
}

export interface PageGenerationInputImageBuilderPort {
  buildInputImages(input: BuildPageGenerationInputImagesInput): Promise<PageGenerationInputImage[]>;
}

export class PageGenerationInputImageBuilder implements PageGenerationInputImageBuilderPort {
  public constructor(
    private readonly pageRepository: PageRepository,
    private readonly entityRepository: EntityRepository,
    private readonly storedImageLoader: StoredImageLoaderPort,
  ) {}

  public async buildInputImages(
    input: BuildPageGenerationInputImagesInput,
  ): Promise<PageGenerationInputImage[]> {
    const page = await this.pageRepository.findGenerationContextByIdAndUserId(input.pageId, input.userId);
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    const entityIds = collectEntityIds(page.panels);
    const references = await this.entityRepository.findPrimaryReferenceImagesByEntityIdsAndUserId(
      entityIds,
      page.workId,
      input.userId,
    );
    const referenceByEntityId = new Map(references.map((reference) => [reference.entityId, reference]));

    const inputImages: PageGenerationInputImage[] = [];
    for (const entityId of entityIds) {
      const reference = referenceByEntityId.get(entityId);
      if (reference === undefined) {
        continue;
      }

      const loadedImage = await this.storedImageLoader.loadByS3Key(reference.s3Key);
      inputImages.push({
        role: 'entity_reference',
        dataUrl: toDataUrl(loadedImage.mimeType, loadedImage.imageData),
      });
    }

    return inputImages;
  }
}

function collectEntityIds(
  panels: Array<{ entities: Array<{ entityId: string }> }>,
): string[] {
  const orderedEntityIds = new Set<string>();
  for (const panel of panels) {
    for (const assignment of panel.entities) {
      orderedEntityIds.add(assignment.entityId);
    }
  }

  return Array.from(orderedEntityIds);
}

function toDataUrl(mimeType: string, imageData: Buffer): string {
  return `data:${mimeType};base64,${imageData.toString('base64')}`;
}
