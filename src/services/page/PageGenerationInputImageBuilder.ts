import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import { PAGE_GENERATION_INPUT_IMAGE_LIMITS } from '../../domain/constants/generation.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../domain/constants/imageInput.js';
import type { PageGenerationInputImage } from '../../domain/types/pageGeneration.js';
import type { EntityRepository } from '../../repositories/EntityRepository.js';
import type { PageRepository } from '../../repositories/PageRepository.js';
import type { StoredImageLoaderPort } from '../../infrastructure/aws/S3StoredImageLoader.js';
import type { LayoutGuideImageRendererPort } from './LayoutGuideImageRenderer.js';
import { ensureOwnedEntityReferenceImageKey } from '../storage/StoredImageKeyPolicy.js';

export interface BuildPageGenerationInputImagesInput {
  userId: string;
  organizationId?: string | null;
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
    private readonly layoutGuideImageRenderer: LayoutGuideImageRendererPort,
  ) {}

  public async buildInputImages(
    input: BuildPageGenerationInputImagesInput,
  ): Promise<PageGenerationInputImage[]> {
    const page = await this.pageRepository.findGenerationContextByIdAndUserId(
      input.pageId,
      input.userId,
      input.organizationId ?? null,
    );
    if (page === null) {
      throw new NotFoundError('Page not found');
    }

    const organizationId = page.organizationId ?? input.organizationId ?? null;
    const entityIds = collectEntityIds(page.panels);
    const entities = await this.entityRepository.findByWorkIdAndUserId(page.workId, input.userId, organizationId);
    const entityNameById = new Map(entities.map((entity) => [entity.id, entity.name]));
    const references = await this.entityRepository.findPrimaryReferenceImagesByEntityIdsAndUserId(
      entityIds,
      page.workId,
      input.userId,
      organizationId,
    );
    const referenceImageCount = new Set(references.map((reference) => reference.entityId)).size;
    if (referenceImageCount > PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES) {
      throw new ValidationError(
        `Page generation supports up to ${PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES} reference images per page. Reduce assigned characters or split the scene.`,
      );
    }

    const referenceByEntityId = new Map(references.map((reference) => [reference.entityId, reference]));

    const inputImages: PageGenerationInputImage[] = [];
    for (const entityId of entityIds) {
      const reference = referenceByEntityId.get(entityId);
      if (reference === undefined) {
        continue;
      }

      ensureOwnedEntityReferenceImageKey(reference.s3Key, reference.ownerUserId ?? input.userId, entityId);
      const loadedImage = await this.storedImageLoader.loadByS3Key(reference.s3Key);
      ensureInputImageWithinLimit(loadedImage.imageData);
      inputImages.push({
        role: 'entity_reference',
        label: entityNameById.get(entityId) ?? `entity-${entityId}`,
        dataUrl: toDataUrl(loadedImage.mimeType, loadedImage.imageData),
      });
    }

    const layoutGuideImage = buildLayoutGuideImage(page.layoutConfig, this.layoutGuideImageRenderer);
    if (layoutGuideImage !== null) {
      inputImages.push({
        role: 'layout_reference',
        label: 'page-layout-reference',
        dataUrl: toDataUrl(layoutGuideImage.mimeType, layoutGuideImage.imageData),
      });
    }

    return inputImages;
  }
}

function buildLayoutGuideImage(
  layoutConfig: Record<string, unknown>,
  layoutGuideImageRenderer: LayoutGuideImageRendererPort,
): { imageData: Buffer; mimeType: 'image/png' } | null {
  if (layoutConfig.type !== 'custom') {
    return null;
  }

  return layoutGuideImageRenderer.render(layoutConfig.frame_definitions);
}

function collectEntityIds(
  panels: Array<{ order: number; entities: Array<{ entityId: string }> }>,
): string[] {
  const orderedEntityIds = new Set<string>();
  for (const panel of [...panels].sort((left, right) => left.order - right.order)) {
    for (const assignment of panel.entities) {
      orderedEntityIds.add(assignment.entityId);
    }
  }

  return Array.from(orderedEntityIds);
}

function ensureInputImageWithinLimit(imageData: Buffer): void {
  if (imageData.length > OPENAI_INPUT_IMAGE_MAX_BYTES) {
    throw new ValidationError(
      `Page generation input image is too large. Maximum size is ${OPENAI_INPUT_IMAGE_MAX_BYTES} bytes.`,
    );
  }
}

function toDataUrl(mimeType: string, imageData: Buffer): string {
  return `data:${mimeType};base64,${imageData.toString('base64')}`;
}
