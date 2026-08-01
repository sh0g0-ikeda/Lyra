import {
  buildPanelFrameTemplateInputs,
  resolveDefaultPanelFrameTemplateId,
} from '../../domain/constants/panelFrameTemplates.js';
import { ValidationError } from '../../domain/errors/index.js';
import type {
  ApplyPagePanelStructureInput,
  PagePanelStructureOperation,
  PagePanelStructureRepository,
  PagePanelStructureResult,
} from '../../repositories/PagePanelStructureRepository.js';

const MAX_PANELS_PER_PAGE = 8;

export interface ApplyPagePanelStructureRequest {
  expectedPanelIds: string[];
  operation: PagePanelStructureOperation;
}

export interface PagePanelStructureServicePort {
  apply(
    userId: string,
    pageId: string,
    input: ApplyPagePanelStructureRequest,
    organizationId?: string | null,
  ): Promise<PagePanelStructureResult>;
}

export class PagePanelStructureService implements PagePanelStructureServicePort {
  public constructor(private readonly repository: PagePanelStructureRepository) {}

  public async apply(
    userId: string,
    pageId: string,
    input: ApplyPagePanelStructureRequest,
    organizationId: string | null = null,
  ): Promise<PagePanelStructureResult> {
    ensureUniqueIds(input.expectedPanelIds, 'expectedPanelIds');
    if (input.expectedPanelIds.length > MAX_PANELS_PER_PAGE) {
      throw new ValidationError('A page can contain at most eight panels');
    }

    const repositoryInput: ApplyPagePanelStructureInput = {
      expectedPanelIds: [...input.expectedPanelIds],
      operation: cloneOperation(input.operation),
      replacementLayout: this.resolveReplacementLayout(input),
    };
    return this.repository.apply(userId, pageId, repositoryInput, organizationId);
  }

  private resolveReplacementLayout(
    input: ApplyPagePanelStructureRequest,
  ): ApplyPagePanelStructureInput['replacementLayout'] {
    if (input.operation.type === 'reorder') {
      ensureReorderMatchesExpected(input.expectedPanelIds, input.operation.panelIds);
      return null;
    }

    const currentCount = input.expectedPanelIds.length;
    if (input.operation.type === 'append') {
      if (currentCount >= MAX_PANELS_PER_PAGE) {
        throw new ValidationError('A page can contain at most eight panels');
      }
      return buildReplacementLayout(currentCount + 1);
    }

    if (currentCount <= 1) {
      throw new ValidationError('A page must retain at least one panel');
    }
    if (!input.expectedPanelIds.includes(input.operation.panelId)) {
      throw new ValidationError('The panel to delete is not in the expected page structure');
    }
    return buildReplacementLayout(currentCount - 1);
  }
}

function buildReplacementLayout(panelCount: number): NonNullable<ApplyPagePanelStructureInput['replacementLayout']> {
  const templateId = resolveDefaultPanelFrameTemplateId(panelCount);
  if (templateId === null) {
    throw new ValidationError('No safe default layout exists for the requested panel count');
  }
  return {
    templateId,
    frameDefinitions: buildPanelFrameTemplateInputs(templateId),
  };
}

function ensureReorderMatchesExpected(expectedPanelIds: string[], requestedPanelIds: string[]): void {
  ensureUniqueIds(requestedPanelIds, 'panelIds');
  if (requestedPanelIds.length !== expectedPanelIds.length) {
    throw new ValidationError('Panel reorder must include every expected panel exactly once');
  }
  const expected = new Set(expectedPanelIds);
  if (requestedPanelIds.some((panelId) => !expected.has(panelId))) {
    throw new ValidationError('Panel reorder must include every expected panel exactly once');
  }
}

function ensureUniqueIds(ids: string[], fieldName: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError(`${fieldName} must not contain duplicate panel ids`);
  }
}

function cloneOperation(operation: PagePanelStructureOperation): PagePanelStructureOperation {
  if (operation.type !== 'reorder') {
    return { ...operation };
  }
  return { type: 'reorder', panelIds: [...operation.panelIds] };
}
