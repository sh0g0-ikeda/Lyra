import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type {
  CreatePanelInput,
  Panel,
  PanelComposition,
  PanelDialogueLine,
  UpdatePanelInput,
} from '../../domain/types/panel.js';
import type { EntityReferenceReader } from '../../repositories/EntityRepository.js';
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
  ) {}

  public async createPanel(userId: string, pageId: string, input: CreatePanelInput): Promise<Panel> {
    const pageContext = await this.panelRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

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
    const deleted = await this.panelRepository.deletePanel(panelId, userId);
    if (!deleted) {
      throw new NotFoundError('Panel not found');
    }
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
