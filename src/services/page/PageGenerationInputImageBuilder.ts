import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import { PAGE_GENERATION_INPUT_IMAGE_LIMITS } from '../../domain/constants/generation.js';
import { OPENAI_INPUT_IMAGE_MAX_BYTES } from '../../domain/constants/imageInput.js';
import type { PageGenerationInputImage } from '../../domain/types/pageGeneration.js';
import type { EntityReferenceAssignment, EntityRepository, EntityResolvedReferenceImage } from '../../repositories/EntityRepository.js';
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
    const assignments = collectAssignments(page.panels);
    const entities = await this.entityRepository.findByWorkIdAndUserId(page.workId, input.userId, organizationId);
    const entityNameById = new Map(entities.map((entity) => [entity.id, entity.name]));
    const references = await resolveReferences(this.entityRepository, assignments, page.workId, input.userId, organizationId);
    assertResolvedStates(assignments, references);
    const referenceImageCount = new Set(
      references.filter(hasResolvedImage).map((reference) => `${reference.entityId}:${reference.stateId ?? 'default'}:${reference.refId}`),
    ).size;
    if (referenceImageCount > PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES) {
      throw new ValidationError(
        `Page generation supports up to ${PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES} reference images per page. Reduce assigned characters or split the scene.`,
      );
    }

    const referenceByAssignment = new Map(references.map((reference) => [referenceKey(reference.entityId, reference.stateId), reference]));

    const inputImages: PageGenerationInputImage[] = [];
    for (const assignment of assignments) {
      const reference = referenceByAssignment.get(referenceKey(assignment.entityId, assignment.stateId));
      if (reference === undefined || !hasResolvedImage(reference)) {
        continue;
      }

      ensureOwnedEntityReferenceImageKey(reference.s3Key, reference.ownerUserId ?? input.userId, assignment.entityId);
      const loadedImage = await this.storedImageLoader.loadByS3Key(reference.s3Key);
      ensureInputImageWithinLimit(loadedImage.imageData);
      inputImages.push({
        role: 'entity_reference',
        label: buildSubjectLabel(
          entityNameById.get(assignment.entityId) ?? `entity-${assignment.entityId}`,
          reference.stateName,
          assignments.some((candidate) => candidate.entityId === assignment.entityId && candidate.stateId !== null),
        ),
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

function collectAssignments(
  panels: Array<{ order: number; entities: Array<{ entityId: string; stateId: string | null }> }>,
): EntityReferenceAssignment[] {
  const orderedAssignments = new Map<string, EntityReferenceAssignment>();
  for (const panel of [...panels].sort((left, right) => left.order - right.order)) {
    for (const assignment of panel.entities) {
      orderedAssignments.set(referenceKey(assignment.entityId, assignment.stateId), { entityId: assignment.entityId, stateId: assignment.stateId });
    }
  }

  return Array.from(orderedAssignments.values());
}

async function resolveReferences(
  repository: EntityRepository,
  assignments: EntityReferenceAssignment[],
  workId: string,
  userId: string,
  organizationId: string | null,
): Promise<EntityResolvedReferenceImage[]> {
  if (repository.findResolvedReferenceImagesByAssignmentsAndUserId !== undefined) {
    return repository.findResolvedReferenceImagesByAssignmentsAndUserId(assignments, workId, userId, organizationId);
  }
  const references = await repository.findPrimaryReferenceImagesByEntityIdsAndUserId(
    Array.from(new Set(assignments.map((assignment) => assignment.entityId))), workId, userId, organizationId,
  );
  return assignments.map((assignment) => {
    const reference = references.find((candidate) => candidate.entityId === assignment.entityId);
    return {
      entityId: assignment.entityId, stateId: assignment.stateId, stateName: null, stateDescription: null,
      stateExists: assignment.stateId === null, ownerUserId: reference?.ownerUserId ?? userId,
      refId: reference?.refId ?? null, s3Key: reference?.s3Key ?? null, cdnUrl: reference?.cdnUrl ?? null, imageModel: null,
    };
  });
}

function assertResolvedStates(assignments: EntityReferenceAssignment[], references: EntityResolvedReferenceImage[]): void {
  for (const assignment of assignments) {
    if (assignment.stateId === null) {
      continue;
    }
    const reference = references.find((candidate) => candidate.entityId === assignment.entityId && candidate.stateId === assignment.stateId);
    if (reference === undefined || !reference.stateExists || (reference.stateDescription !== null && !hasResolvedImage(reference))) {
      throw new ValidationError('Assigned character state requires a confirmed reference image before page generation');
    }
  }
}

function hasResolvedImage(reference: EntityResolvedReferenceImage): reference is EntityResolvedReferenceImage & { refId: string; s3Key: string } {
  return reference.refId !== null && reference.s3Key !== null;
}

function referenceKey(entityId: string, stateId: string | null): string {
  return `${entityId}:${stateId ?? 'default'}`;
}

function buildSubjectLabel(canonicalName: string, stateName: string | null, includeDefault: boolean): string {
  if (stateName === null && !includeDefault) {
    return canonicalName;
  }
  return `${canonicalName} / ${stateName ?? 'default'}`;
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
