import {
  buildPanelFrameTemplateInputs,
  getPanelFrameTemplate,
} from '../../domain/constants/panelFrameTemplates.js';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors/index.js';
import type {
  PanelFrame,
  PanelFrameTemplateApplication,
  PanelFrameTemplateId,
  UpsertPanelFrameInput,
} from '../../domain/types/panelFrame.js';
import type { PageStatus } from '../../domain/types/page.js';
import type { PanelFrameRepository } from '../../repositories/PanelFrameRepository.js';

export type {
  PanelFrame,
  PanelFrameTemplateApplication,
  PanelFrameTemplateId,
  UpsertPanelFrameInput as UpsertPanelFrameRequest,
};

export interface PanelFrameServicePort {
  listPageFrames(userId: string, pageId: string, organizationId?: string | null): Promise<PanelFrame[]>;
  replacePageFrames(
    userId: string,
    pageId: string,
    frames: UpsertPanelFrameInput[],
    organizationId?: string | null,
  ): Promise<PanelFrame[]>;
  applyTemplate(
    userId: string,
    pageId: string,
    templateId: PanelFrameTemplateId,
    organizationId?: string | null,
  ): Promise<PanelFrameTemplateApplication>;
}

/**
 * Owns PanelFrame business rules: a layout can only be read or replaced after
 * the page owner is verified, and referenced panels must belong to that page.
 */
export class PanelFrameService implements PanelFrameServicePort {
  public constructor(private readonly panelFrameRepository: PanelFrameRepository) {}

  public async listPageFrames(
    userId: string,
    pageId: string,
    organizationId: string | null = null,
  ): Promise<PanelFrame[]> {
    await this.ensurePageOwnedByUser(userId, pageId, organizationId);
    return this.panelFrameRepository.findFramesByPageIdAndUserId(pageId, userId, organizationId);
  }

  public async replacePageFrames(
    userId: string,
    pageId: string,
    frames: UpsertPanelFrameInput[],
    organizationId: string | null = null,
  ): Promise<PanelFrame[]> {
    await this.ensurePageOwnedByUser(userId, pageId, organizationId);
    await this.ensurePanelsBelongToPage(userId, pageId, frames, organizationId);

    return this.panelFrameRepository.replaceFramesByPageIdAndUserId(pageId, userId, frames, {
      type: 'custom',
      panelCount: frames.length,
      frameDefinitions: frames,
    }, organizationId);
  }

  public async applyTemplate(
    userId: string,
    pageId: string,
    templateId: PanelFrameTemplateId,
    organizationId: string | null = null,
  ): Promise<PanelFrameTemplateApplication> {
    await this.ensurePageOwnedByUser(userId, pageId, organizationId);

    const template = getPanelFrameTemplate(templateId);
    const frames = buildPanelFrameTemplateInputs(templateId);
    const savedFrames = await this.panelFrameRepository.replaceFramesByPageIdAndUserId(
      pageId,
      userId,
      frames,
      {
        type: 'template',
        templateId,
        panelCount: template.panelCount,
        frameDefinitions: frames,
      },
      organizationId,
    );

    return {
      templateId,
      panelCount: template.panelCount,
      frames: savedFrames,
    };
  }

  private async ensurePageOwnedByUser(
    userId: string,
    pageId: string,
    organizationId: string | null,
  ): Promise<void> {
    const pageContext = await this.panelFrameRepository.findPageContextByIdAndUserId(
      pageId,
      userId,
      organizationId,
    );
    if (pageContext === null) {
      throw new NotFoundError('Page not found');
    }

    ensurePageLayoutEditable(pageContext.pageStatus);
  }

  private async ensurePanelsBelongToPage(
    userId: string,
    pageId: string,
    frames: UpsertPanelFrameInput[],
    organizationId: string | null,
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
      organizationId,
    );
    const matchedPanelIdSet = new Set(matchedPanelIds);
    const hasMissingPanel = requestedPanelIds.some((panelId) => !matchedPanelIdSet.has(panelId));

    if (hasMissingPanel) {
      throw new ValidationError('All panel_id values must belong to the page');
    }
  }
}

function ensurePageLayoutEditable(pageStatus: PageStatus): void {
  if (pageStatus === 'confirmed') {
    throw new ConflictError('Confirmed pages must be reopened before editing frames');
  }

  if (pageStatus === 'generating') {
    throw new ConflictError('Pages cannot edit frames while generation is in progress');
  }
}
