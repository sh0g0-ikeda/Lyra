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
  createPanel(userId: string, pageId: string, input: CreatePanelInput): Promise<Panel>;
  listPanels(userId: string, pageId: string): Promise<Panel[]>;
  updatePanel(userId: string, panelId: string, input: UpdatePanelInput): Promise<Panel>;
  deletePanel(userId: string, panelId: string): Promise<void>;
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
  ) {}

  public async createPanel(userId: string, pageId: string, input: CreatePanelInput): Promise<Panel> {
    const pageContext = await this.panelRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }
    ensurePageEditable(pageContext.pageStatus, 'panels');

    const normalizedInput = normalizeCreateInput(input);
    const dialogue = normalizedInput.dialogue ?? [];
    ensureDialogueShape(dialogue);
    await this.ensureDialogueEntitiesBelongToWork(userId, pageContext.workId, dialogue);

    const panel = await this.panelRepository.createPanel(pageId, userId, normalizedInput);
    if (panel === null) {
      throw new NotFoundError('Page not found');
    }

    return panel;
  }

  public async listPanels(userId: string, pageId: string): Promise<Panel[]> {
    const pageContext = await this.panelRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    return this.panelRepository.findPanelsByPageIdAndUserId(pageId, userId);
  }

  public async updatePanel(userId: string, panelId: string, input: UpdatePanelInput): Promise<Panel> {
    const panelContext = await this.panelRepository.findPanelContextByIdAndUserId(panelId, userId);
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
      );
    }

    const panel = await this.panelRepository.updatePanel(panelId, userId, normalizedInput);
    if (panel === null) {
      throw new NotFoundError('Panel not found');
    }

    return panel;
  }

  public async deletePanel(userId: string, panelId: string): Promise<void> {
    const panelContext = await this.panelRepository.findPanelContextByIdAndUserId(panelId, userId);
    if (panelContext === null) {
      throw new NotFoundError('Panel not found');
    }

    ensurePageEditable(panelContext.pageStatus, 'panels');

    const deleted = await this.panelRepository.deletePanel(panelId, userId);
    if (!deleted) {
      throw new NotFoundError('Panel not found');
    }

    await this.panelRepository.compactPanelOrdersAfterDelete(
      panelContext.pageId,
      userId,
      panelContext.panelOrder,
    );
    await this.reconcileFramesAfterDelete(
      userId,
      panelContext.pageId,
      panelContext.panelOrder,
    );
  }

  private async ensureDialogueEntitiesBelongToWork(
    userId: string,
    workId: string,
    dialogue: PanelDialogueLine[],
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

    const matchedEntityCount = await this.entityReader.countByIdsAndWorkIdAndUserId(
      entityIds,
      workId,
      userId,
    );
    if (matchedEntityCount !== entityIds.length) {
      throw new ValidationError('All dialogue entity_id values must belong to the panel work');
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
  ): Promise<void> {
    const currentFrames = await this.panelFrameRepository.findFramesByPageIdAndUserId(pageId, userId);
    if (currentFrames.length === 0) {
      return;
    }

    const remainingPanels = await this.panelRepository.findPanelsByPageIdAndUserId(pageId, userId);
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
    });
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
