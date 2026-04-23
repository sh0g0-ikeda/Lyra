import { NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type { PanelFrame, UpsertPanelFrameInput } from '../../domain/types/panelFrame.js';
import type { PanelFrameRepository } from '../../repositories/PanelFrameRepository.js';

export type {
  PanelFrame,
  UpsertPanelFrameInput as UpsertPanelFrameRequest,
};

export interface PanelFrameServicePort {
  listPageFrames(userId: string, pageId: string): Promise<PanelFrame[]>;
  replacePageFrames(
    userId: string,
    pageId: string,
    frames: UpsertPanelFrameInput[],
  ): Promise<PanelFrame[]>;
}

/**
 * Owns PanelFrame business rules: a layout can only be read or replaced after
 * the page owner is verified, and referenced panels must belong to that page.
 */
export class PanelFrameService implements PanelFrameServicePort {
  public constructor(private readonly panelFrameRepository: PanelFrameRepository) {}

  public async listPageFrames(userId: string, pageId: string): Promise<PanelFrame[]> {
    await this.ensurePageOwnedByUser(userId, pageId);
    return this.panelFrameRepository.findFramesByPageIdAndUserId(pageId, userId);
  }

  public async replacePageFrames(
    userId: string,
    pageId: string,
    frames: UpsertPanelFrameInput[],
  ): Promise<PanelFrame[]> {
    await this.ensurePageOwnedByUser(userId, pageId);
    await this.ensurePanelsBelongToPage(userId, pageId, frames);

    return this.panelFrameRepository.replaceFramesByPageIdAndUserId(pageId, userId, frames);
  }

  private async ensurePageOwnedByUser(userId: string, pageId: string): Promise<void> {
    const pageContext = await this.panelFrameRepository.findPageContextByIdAndUserId(pageId, userId);
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }
  }

  private async ensurePanelsBelongToPage(
    userId: string,
    pageId: string,
    frames: UpsertPanelFrameInput[],
  ): Promise<void> {
    const requestedPanelIds = [
      ...new Set(frames.flatMap((frame) => (frame.panelId === null ? [] : [frame.panelId]))),
    ];
    if (requestedPanelIds.length === 0) {
      return;
    }

    const matchedPanelIds = await this.panelFrameRepository.findPanelIdsByPageIdAndUserId(
      pageId,
      userId,
      requestedPanelIds,
    );
    const matchedPanelIdSet = new Set(matchedPanelIds);
    const hasMissingPanel = requestedPanelIds.some((panelId) => !matchedPanelIdSet.has(panelId));

    if (hasMissingPanel) {
      throw new ValidationError('All panel_id values must belong to the page');
    }
  }
}
