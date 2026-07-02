import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type {
  CreatePanelInput,
  Panel,
  PanelComposition,
  PanelDialogueLine,
  UpdatePanelInput,
} from '../../domain/types/panel.js';
import type { PanelFrame, UpsertPanelFrameInput } from '../../domain/types/panelFrame.js';
import type { PageStatus } from '../../domain/types/page.js';
import type { EntityReferenceReader } from '../../repositories/EntityRepository.js';
import type { PanelFrameRepository } from '../../repositories/PanelFrameRepository.js';
import type { PanelRepository } from '../../repositories/PanelRepository.js';

export type {
  CreatePanelInput as CreatePanelRequest,
  Panel,
  UpdatePanelInput as UpdatePanelRequest,
};

export interface PanelServicePort {
  createPanel(
    userId: string,
    pageId: string,
    input: CreatePanelInput,
    organizationId?: string | null,
  ): Promise<Panel>;
  listPanels(userId: string, pageId: string, organizationId?: string | null): Promise<Panel[]>;
  updatePanel(
    userId: string,
    panelId: string,
    input: UpdatePanelInput,
    organizationId?: string | null,
  ): Promise<Panel>;
  deletePanel(userId: string, panelId: string, organizationId?: string | null): Promise<void>;
  reorderPanels(
    userId: string,
    pageId: string,
    panelIds: string[],
    organizationId?: string | null,
  ): Promise<Panel[]>;
}

export interface CompositionGalleryReferenceReader {
  findByIds(ids: string[]): Promise<Array<{ id: string }>>;
}

/**
 * Coordinates Panel writes so page ownership and related entity references are
 * validated before persistence.
 */
export class PanelService implements PanelServicePort {
  public constructor(
    private readonly panelRepository: PanelRepository,
    private readonly entityReader: EntityReferenceReader,
    private readonly panelFrameRepository: PanelFrameRepository,
    private readonly compositionGalleryReader?: CompositionGalleryReferenceReader,
  ) {}

  public async createPanel(
    userId: string,
    pageId: string,
    input: CreatePanelInput,
    organizationId: string | null = null,
  ): Promise<Panel> {
    const pageContext = await this.panelRepository.findPageContextByIdAndUserId(pageId, userId, organizationId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }
    ensurePageEditable(pageContext.pageStatus, 'panels');

    const normalizedInput = normalizeCreateInput(input);
    const dialogue = normalizedInput.dialogue ?? [];
    ensureDialogueShape(dialogue);
    await this.ensureDialogueEntitiesBelongToWork(userId, pageContext.workId, dialogue, organizationId);
    await this.ensureGalleryCompositionExists(normalizedInput.composition);

    const panel = await this.panelRepository.createPanel(pageId, userId, normalizedInput, organizationId);
    if (panel === null) {
      throw new NotFoundError('Page not found');
    }

    return panel;
  }

  public async listPanels(userId: string, pageId: string, organizationId: string | null = null): Promise<Panel[]> {
    const pageContext = await this.panelRepository.findPageContextByIdAndUserId(pageId, userId, organizationId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    return this.panelRepository.findPanelsByPageIdAndUserId(pageId, userId, organizationId);
  }

  public async updatePanel(
    userId: string,
    panelId: string,
    input: UpdatePanelInput,
    organizationId: string | null = null,
  ): Promise<Panel> {
    const panelContext = await this.panelRepository.findPanelContextByIdAndUserId(panelId, userId, organizationId);
    if (panelContext === null) {
      throw new NotFoundError('Panel not found');
    }
    ensurePageEditable(panelContext.pageStatus, 'panels');

    const normalizedInput = normalizeUpdateInput(input);
    if (normalizedInput.dialogue !== undefined) {
      ensureDialogueShape(normalizedInput.dialogue);
      await this.ensureDialogueEntitiesBelongToWork(
        userId,
        panelContext.workId,
        normalizedInput.dialogue,
        organizationId,
      );
    }
    await this.ensureGalleryCompositionExists(normalizedInput.composition);

    const panel = await this.panelRepository.updatePanel(panelId, userId, normalizedInput, organizationId);
    if (panel === null) {
      throw new NotFoundError('Panel not found');
    }

    return panel;
  }

  public async deletePanel(userId: string, panelId: string, organizationId: string | null = null): Promise<void> {
    const panelContext = await this.panelRepository.findPanelContextByIdAndUserId(panelId, userId, organizationId);
    if (panelContext === null) {
      throw new NotFoundError('Panel not found');
    }

    ensurePageEditable(panelContext.pageStatus, 'panels');

    const deleted = await this.panelRepository.deletePanel(panelId, userId, organizationId);
    if (!deleted) {
      throw new NotFoundError('Panel not found');
    }

    await this.panelRepository.compactPanelOrdersAfterDelete(
      panelContext.pageId,
      userId,
      panelContext.panelOrder,
      organizationId,
    );
    await this.reconcileFramesAfterDelete(
      userId,
      panelContext.pageId,
      panelContext.panelOrder,
      organizationId,
    );
  }

  public async reorderPanels(
    userId: string,
    pageId: string,
    panelIds: string[],
    organizationId: string | null = null,
  ): Promise<Panel[]> {
    const pageContext = await this.panelRepository.findPageContextByIdAndUserId(pageId, userId, organizationId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }
    ensurePageEditable(pageContext.pageStatus, 'panels');

    const currentPanels = await this.panelRepository.findPanelsByPageIdAndUserId(pageId, userId, organizationId);
    ensurePanelReorderMatchesCurrentPanels(currentPanels, panelIds);

    const reorderedPanels = await this.panelRepository.reorderPanels(pageId, userId, panelIds, organizationId);
    ensurePanelReorderMatchesCurrentPanels(reorderedPanels, panelIds);
    ensurePanelOrderMatchesRequest(reorderedPanels, panelIds);
    await this.reconcileFramesAfterReorder(userId, pageId, reorderedPanels, organizationId);

    return reorderedPanels;
  }

  private async ensureDialogueEntitiesBelongToWork(
    userId: string,
    workId: string,
    dialogue: PanelDialogueLine[],
    organizationId: string | null,
  ): Promise<void> {
    const entityIds = [
      ...new Set(
        dialogue
          .map((line) => line.entityId)
          .filter((entityId): entityId is string => entityId !== null),
      ),
    ];

    if (entityIds.length === 0) {
      return;
    }

    const matchedEntityCount =
      organizationId === null || this.entityReader.countByIdsAndWorkId === undefined
        ? await this.entityReader.countByIdsAndWorkIdAndUserId(entityIds, workId, userId)
        : await this.entityReader.countByIdsAndWorkId(entityIds, workId);
    if (matchedEntityCount !== entityIds.length) {
      throw new ValidationError('All dialogue entity_id values must belong to the panel work');
    }
  }

  private async ensureGalleryCompositionExists(composition: PanelComposition | undefined): Promise<void> {
    if (
      composition === undefined ||
      composition.source !== 'gallery' ||
      composition.galleryItemId === null ||
      this.compositionGalleryReader === undefined
    ) {
      return;
    }

    const matchedItems = await this.compositionGalleryReader.findByIds([composition.galleryItemId]);
    if (!matchedItems.some((item) => item.id === composition.galleryItemId)) {
      throw new ValidationError('galleryItemId must reference an existing composition gallery item');
    }
  }

  /**
   * Deleting a panel changes the page beat count. Keep frame count and reading
   * order aligned so generation invariants still hold after a delete.
   */
  private async reconcileFramesAfterDelete(
    userId: string,
    pageId: string,
    deletedOrder: number,
    organizationId: string | null,
  ): Promise<void> {
    const currentFrames = await this.panelFrameRepository.findFramesByPageIdAndUserId(pageId, userId, organizationId);
    if (currentFrames.length === 0) {
      return;
    }

    const remainingPanels = await this.panelRepository.findPanelsByPageIdAndUserId(pageId, userId, organizationId);
    const targetCount = remainingPanels.length;
    const compactedFrames = compactFramesForDeletedPanel(currentFrames, deletedOrder, targetCount);

    if (!didFramesChange(currentFrames, compactedFrames)) {
      return;
    }

    const frameInputs = compactedFrames.map(toFrameInput);
    await this.panelFrameRepository.replaceFramesByPageIdAndUserId(pageId, userId, frameInputs, {
      type: 'custom',
      panelCount: frameInputs.length,
      frameDefinitions: frameInputs,
    }, organizationId);
  }

  private async reconcileFramesAfterReorder(
    userId: string,
    pageId: string,
    reorderedPanels: Panel[],
    organizationId: string | null,
  ): Promise<void> {
    const currentFrames = await this.panelFrameRepository.findFramesByPageIdAndUserId(pageId, userId, organizationId);
    if (currentFrames.length === 0 || currentFrames.length !== reorderedPanels.length) {
      return;
    }

    const panelOrderById = new Map(
      reorderedPanels.map((panel, index) => [panel.id, index + 1] as const),
    );
    const framePanelIds = new Set(currentFrames.map((frame) => frame.panelId));
    const everyPanelHasFrame = reorderedPanels.every((panel) => framePanelIds.has(panel.id));
    if (!everyPanelHasFrame) {
      return;
    }

    const reorderedFrames = [...currentFrames]
      .sort((left, right) => {
        const leftOrder =
          left.panelId === null
            ? Number.MAX_SAFE_INTEGER
            : panelOrderById.get(left.panelId) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder =
          right.panelId === null
            ? Number.MAX_SAFE_INTEGER
            : panelOrderById.get(right.panelId) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder === rightOrder ? left.readingOrder - right.readingOrder : leftOrder - rightOrder;
      })
      .map((frame, index) => ({
        ...frame,
        readingOrder: index + 1,
      }));

    if (!didFramesChange(currentFrames, reorderedFrames)) {
      return;
    }

    const frameInputs = reorderedFrames.map(toFrameInput);
    await this.panelFrameRepository.replaceFramesByPageIdAndUserId(pageId, userId, frameInputs, {
      type: 'custom',
      panelCount: frameInputs.length,
      frameDefinitions: frameInputs,
    }, organizationId);
  }
}

function normalizeCreateInput(input: CreatePanelInput): CreatePanelInput {
  return {
    order: input.order,
    panelRole: input.panelRole ?? 'action',
    panelSize: input.panelSize ?? 'standard',
    situationText: input.situationText ?? null,
    composition: normalizeComposition(input.composition),
    dialogueInPanel: input.dialogueInPanel ?? true,
    dialogue: input.dialogue ?? [],
    sfxText: input.sfxText ?? null,
    backgroundNote: input.backgroundNote ?? null,
    panelNotes: input.panelNotes ?? null,
  };
}

function normalizeUpdateInput(input: UpdatePanelInput): UpdatePanelInput {
  return {
    ...input,
    composition: input.composition === undefined ? undefined : normalizeComposition(input.composition),
  };
}

function normalizeComposition(composition: PanelComposition | undefined): PanelComposition {
  const normalizedComposition = composition ?? {
    source: 'custom',
    galleryItemId: null,
    compositionPrompt: null,
    shotType: null,
    angle: null,
    customNote: null,
  };

  if (normalizedComposition.source === 'gallery' && normalizedComposition.galleryItemId === null) {
    throw new ValidationError('galleryItemId is required when composition source is gallery');
  }

  return {
    ...normalizedComposition,
    galleryItemId:
      normalizedComposition.source === 'gallery' ? normalizedComposition.galleryItemId : null,
  };
}

function ensurePanelReorderMatchesCurrentPanels(currentPanels: Panel[], panelIds: string[]): void {
  if (currentPanels.length !== panelIds.length) {
    throw new ValidationError('Panel reorder must include every current panel exactly once');
  }

  const currentPanelIds = new Set(currentPanels.map((panel) => panel.id));
  const requestedPanelIds = new Set<string>();

  for (const panelId of panelIds) {
    if (!currentPanelIds.has(panelId)) {
      throw new ValidationError('Panel reorder includes an unknown panel id');
    }
    if (requestedPanelIds.has(panelId)) {
      throw new ValidationError('Panel reorder includes duplicate panel ids');
    }
    requestedPanelIds.add(panelId);
  }
}

function ensurePanelOrderMatchesRequest(panels: Panel[], panelIds: string[]): void {
  for (const [index, panelId] of panelIds.entries()) {
    if (panels[index]?.id !== panelId) {
      throw new ValidationError('Panel reorder was not persisted');
    }
  }
}

function compactFramesForDeletedPanel(
  currentFrames: PanelFrame[],
  deletedOrder: number,
  targetCount: number,
): PanelFrame[] {
  const sortedFrames = [...currentFrames].sort((left, right) => left.readingOrder - right.readingOrder);
  const withoutDeletedSlot = sortedFrames.filter((frame) => frame.readingOrder !== deletedOrder);
  const trimmedFrames =
    withoutDeletedSlot.length > targetCount
      ? withoutDeletedSlot.slice(0, targetCount)
      : withoutDeletedSlot;

  return trimmedFrames.map((frame, index) => ({
    ...frame,
    readingOrder: index + 1,
  }));
}

function didFramesChange(before: PanelFrame[], after: PanelFrame[]): boolean {
  if (before.length !== after.length) {
    return true;
  }

  const sortedBefore = [...before].sort((left, right) => left.readingOrder - right.readingOrder);
  return sortedBefore.some((frame, index) => {
    const nextFrame = after[index];
    return (
      nextFrame === undefined ||
      frame.id !== nextFrame.id ||
      frame.readingOrder !== nextFrame.readingOrder ||
      frame.panelId !== nextFrame.panelId
    );
  });
}

function toFrameInput(frame: PanelFrame): UpsertPanelFrameInput {
  return {
    id: frame.id,
    panelId: frame.panelId,
    vertices: frame.vertices.map((vertex) => ({ ...vertex })),
    borderStyle: frame.borderStyle,
    borderWidth: frame.borderWidth,
    borderColor: frame.borderColor,
    zIndex: frame.zIndex,
    readingOrder: frame.readingOrder,
  };
}

function ensureDialogueShape(dialogue: PanelDialogueLine[]): void {
  for (const line of dialogue) {
    if (requiresSpeaker(line.type) && line.entityId === null) {
      throw new ValidationError('entityId is required for speaker dialogue types');
    }
  }
}

function requiresSpeaker(type: PanelDialogueLine['type']): boolean {
  return type === 'speech' || type === 'thought' || type === 'shout' || type === 'whisper';
}

function ensurePageEditable(pageStatus: PageStatus, scope: string): void {
  if (pageStatus === 'confirmed') {
    throw new ConflictError(`Confirmed pages must be reopened before editing ${scope}`);
  }

  if (pageStatus === 'generating') {
    throw new ConflictError(`Pages cannot edit ${scope} while generation is in progress`);
  }
}
