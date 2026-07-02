import {
  buildPanelFrameTemplateInputs,
  getPanelFrameTemplate,
} from '../../domain/constants/panelFrameTemplates.js';
import type {
  PageLayoutTemplateApplication,
  PanelFrameTemplateId,
} from '../../domain/types/panelFrame.js';
import type { PageLayoutRepository } from '../../repositories/PageLayoutRepository.js';

export interface ApplyPageLayoutTemplateRequest {
  templateId: PanelFrameTemplateId;
  allowPanelTruncation: boolean;
}

export interface PageLayoutServicePort {
  applyTemplate(
    userId: string,
    pageId: string,
    input: ApplyPageLayoutTemplateRequest,
    organizationId?: string | null,
  ): Promise<PageLayoutTemplateApplication>;
}

/**
 * User-facing page layout changes. Unlike low-level frame editing, this keeps
 * panels and frames synchronized so page generation invariants remain valid.
 */
export class PageLayoutService implements PageLayoutServicePort {
  public constructor(private readonly pageLayoutRepository: PageLayoutRepository) {}

  public async applyTemplate(
    userId: string,
    pageId: string,
    input: ApplyPageLayoutTemplateRequest,
    organizationId: string | null = null,
  ): Promise<PageLayoutTemplateApplication> {
    const template = getPanelFrameTemplate(input.templateId);

    return this.pageLayoutRepository.applyTemplateAndSyncPanels(
      userId,
      pageId,
      {
        templateId: input.templateId,
        targetPanelCount: template.panelCount,
        frameDefinitions: buildPanelFrameTemplateInputs(input.templateId),
        allowPanelTruncation: input.allowPanelTruncation,
      },
      organizationId,
    );
  }
}
