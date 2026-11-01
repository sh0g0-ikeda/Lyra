import { ValidationError } from '../../domain/errors/index.js';
import { PAGE_SCENE_AUDIT_MAX_DIRECTIVES } from '../../domain/constants/generation.js';
import type { PageGenerationInputImage, PageGenerationInputSnapshot } from '../../domain/types/pageGeneration.js';
import type { PageGenerationLayoutControl } from './PageGenerationLayoutControl.js';

export type PagePreRenderSceneAuditKind =
  | 'appearance'
  | 'anatomy_motion'
  | 'interaction'
  | 'object_integrity'
  | 'scale';

export interface PagePreRenderSceneAuditDirective {
  panelOrder: number;
  kind: PagePreRenderSceneAuditKind;
  entityIds: string[];
}

export interface PagePreRenderSceneAuditResult {
  verdict: 'pass' | 'guidance' | 'uncertain';
  directives: PagePreRenderSceneAuditDirective[];
}

export interface PagePreRenderSceneAuditInput {
  prompt: string;
  compilerBrief: string;
  inputSnapshot: PageGenerationInputSnapshot;
  inputImages: PageGenerationInputImage[];
  layoutControl?: PageGenerationLayoutControl | null;
  internalPlan: string | null;
}

export interface PagePreRenderSceneAuditorPort {
  audit(input: PagePreRenderSceneAuditInput): Promise<PagePreRenderSceneAuditResult>;
}

export class NoopPagePreRenderSceneAuditor implements PagePreRenderSceneAuditorPort {
  public async audit(_input: PagePreRenderSceneAuditInput): Promise<PagePreRenderSceneAuditResult> {
    return { verdict: 'uncertain', directives: [] };
  }
}

export function validatePagePreRenderSceneAudit(
  input: PagePreRenderSceneAuditInput,
  result: PagePreRenderSceneAuditResult,
): PagePreRenderSceneAuditResult {
  if (result.verdict !== 'pass' && result.verdict !== 'guidance' && result.verdict !== 'uncertain') {
    throw new ValidationError('Page pre-render scene audit verdict is invalid');
  }
  if (!Array.isArray(result.directives) || result.directives.length > PAGE_SCENE_AUDIT_MAX_DIRECTIVES) {
    throw new ValidationError('Page pre-render scene audit directives are invalid');
  }
  if ((result.verdict === 'guidance') !== (result.directives.length > 0)) {
    throw new ValidationError('Page pre-render scene audit verdict does not match directives');
  }

  const panelsByOrder = new Map(input.inputSnapshot.panels.map((panel) => [panel.order, panel]));
  const seen = new Set<string>();
  const directives = result.directives.map((directive) => {
    if (!Number.isSafeInteger(directive.panelOrder) || directive.panelOrder < 1) {
      throw new ValidationError('Page pre-render scene audit panel is invalid');
    }
    const panel = panelsByOrder.get(directive.panelOrder);
    if (panel === undefined) throw new ValidationError('Page pre-render scene audit targets an unknown panel');
    if (!isAuditKind(directive.kind) || !Array.isArray(directive.entityIds)) {
      throw new ValidationError('Page pre-render scene audit directive is invalid');
    }
    const entityIds = directive.entityIds.map((entityId) => validateEntityId(entityId));
    const expectedCount = directive.kind === 'interaction' ? 2 : 1;
    if (entityIds.length !== expectedCount || new Set(entityIds).size !== entityIds.length) {
      throw new ValidationError('Page pre-render scene audit directive entity count is invalid');
    }
    if (!entityIds.every((entityId) => panel.entityIds.includes(entityId))) {
      throw new ValidationError('Page pre-render scene audit targets an unassigned entity');
    }
    const key = `${directive.panelOrder}:${directive.kind}:${[...entityIds].sort().join(',')}`;
    if (seen.has(key)) throw new ValidationError('Page pre-render scene audit contains duplicate directives');
    seen.add(key);
    return { panelOrder: directive.panelOrder, kind: directive.kind, entityIds };
  });
  return { verdict: result.verdict, directives };
}

export function buildPageSceneGuidance(
  input: PagePreRenderSceneAuditInput,
  result: PagePreRenderSceneAuditResult,
): string | null {
  const validated = validatePagePreRenderSceneAudit(input, result);
  if (validated.verdict !== 'guidance') return null;

  const panelByOrder = new Map(input.inputSnapshot.panels.map((panel) => [panel.order, panel]));
  const lines = validated.directives.map((directive) => {
    const panel = panelByOrder.get(directive.panelOrder)!;
    const names = directive.entityIds.map((entityId) => {
      const index = panel.entityIds.indexOf(entityId);
      return panel.entityNames[index] ?? entityId;
    });
    return directiveTemplate(directive.kind, directive.panelOrder, names);
  });
  return ['[PRE-RENDER SCENE INTEGRITY GUIDANCE]', ...lines].join('\n');
}

function directiveTemplate(kind: PagePreRenderSceneAuditKind, panelOrder: number, names: string[]): string {
  const subjects = names.join(' and ');
  const foundation = `Panel ${panelOrder}: preserve the exact authored subject set and original reference/state assignment for ${subjects}.`;
  switch (kind) {
    case 'appearance':
      return `${foundation} Preserve supplied appearance and any authored state override; do not substitute hair, face, clothing, species, or design.`;
    case 'anatomy_motion':
      return `${foundation} Use the selected reference anatomy and adapt the authored action without inventing unreferenced anatomy; intentional selected-state changes remain authoritative. Do not add, remove, or duplicate limbs, hands, or bodies.`;
    case 'interaction':
      return `${foundation} Preserve the authored interaction between these two subjects only; do not invent another holder, participant, or contact.`;
    case 'object_integrity':
      return `${foundation} Preserve the authored object count, silhouette, component count and connections, and holder relationship; do not duplicate, split, merge, or add components to objects.`;
    case 'scale':
      return `${foundation} Preserve the authored relative scale and silhouette; intentional fantasy species and scale are authoritative.`;
  }
}

function isAuditKind(value: string): value is PagePreRenderSceneAuditKind {
  return ['appearance', 'anatomy_motion', 'interaction', 'object_integrity', 'scale'].includes(value);
}

function validateEntityId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ValidationError('Page pre-render scene audit entity is invalid');
  }
  return value;
}
